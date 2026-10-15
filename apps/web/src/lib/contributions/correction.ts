/**
 * Accepting a correction: a quest line the corpus has, sent back by a player's client with
 * different text (known.ts's "changed"), taken as what the line now speaks.
 *
 * It is the explorer's text edit done in one click, not resolve's accept: that writes a line
 * that is missing (accept.ts), and this line is not. So it writes what the explorer's editor
 * would -- an English line's spoken rewrite (line_override, keyed by its file), another
 * language's new text version -- and marks the contribution accepted. The printed text the
 * correction was compared on (originalText, localeText) is left as the extract had it, as an
 * editor's fix leaves it: it is what names the file and what the addon matches on. The row
 * stays on the corrections tab, accepted (known.ts's tabOf).
 *
 * Both writes say where the text came from: the activity log names the contribution, and a
 * translation's version carries it in its note. line_override has no column for it.
 *
 * The English text is the template made spoken (tokens.ts), as accept.ts writes a contributed
 * line; another language keeps its $N, $C and $R, as accept does, for player-words.ts
 * to speak in that language. A template that branches on the player's gender is two lines in
 * either language: saveQuestText splits a translation, and correctEnglish an English line.
 *
 * Not one transaction with the status flip: the two writers own theirs, and both are
 * idempotent -- the same text again spends no version and logs nothing -- so an accept that
 * fails after the text is written is simply sent again.
 */
import "server-only";

import { recordActivity } from "@/lib/activity/store";
import { audioRelPath } from "@/lib/audio";
import type { CorpusLine } from "@/lib/corpus";
import { db } from "@/lib/db";
import { BASE_LANG, isLang } from "@/lib/lang";
import { branchesOnPlayerGender, speakPlayerTokens } from "@/lib/player-words";
import { OverrideError, validateOverride } from "@/lib/quests/override";
import { writeOverride } from "@/lib/quests/overrides";
import { QuestTextConflict, QuestTextMissing, saveQuestText } from "@/lib/quests/text";
import { skipReasonFor } from "@/lib/text-gate";

import { CONTRIBUTED_ORD_FLOOR } from "./accept";
import { lineStates } from "./known";
import { answersQuestMomentSql, momentOf, playerGenderForms } from "./naming";
import { CONTRIBUTION_COLUMNS, type Contribution } from "./store";
import { spokenFromTemplate } from "./tokens";

export type CorrectionOutcome =
  | { ok: true; contribution: Contribution }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "not-a-correction" | "malformed"; message: string };

/** The note a translation's version carries, so its history says where the text came from. */
export function correctionNote(contributionId: number): string {
  return `correction from the game, contribution #${contributionId}`;
}

export async function acceptCorrection(id: number, userId: string): Promise<CorrectionOutcome> {
  const { rows } = await db().query<Contribution>(
    `select ${CONTRIBUTION_COLUMNS} from "contribution" where "id" = $1`,
    [id],
  );
  const contribution = rows[0];
  if (!contribution) return { ok: false, reason: "not-found" };
  const lang = contribution.locale;
  if (contribution.source !== "quests" || !contribution.text || !isLang(lang)) {
    return { ok: false, reason: "not-a-correction", message: "Only a quest line sent in a site language is a correction." };
  }

  const [state] = await lineStates([contribution]);
  if (state.kind !== "changed") {
    return {
      ok: false,
      reason: "not-a-correction",
      message: "The corpus no longer has a different text for this line -- nothing to correct.",
    };
  }

  try {
    if (lang === BASE_LANG) {
      const refusal = await correctEnglish(momentOf(state.lineId), state.variant, contribution.text, id, userId);
      if (refusal) return refusal;
    } else {
      await saveQuestText({
        lineId: state.lineId,
        variant: state.variant,
        lang,
        text: contribution.text,
        note: correctionNote(id),
        editedBy: userId,
        contribution: id,
      });
    }
  } catch (error) {
    if (error instanceof OverrideError || error instanceof QuestTextMissing || error instanceof QuestTextConflict) {
      return { ok: false, reason: "malformed", message: error.message };
    }
    throw error;
  }

  const client = await db().connect();
  try {
    await client.query("begin");
    const updated = await client.query<Contribution>(
      `update "contribution"
          set "status" = 'accepted', "resolvedBy" = $2, "updatedAt" = now()
        where "id" = $1
        returning ${CONTRIBUTION_COLUMNS}`,
      [id, userId],
    );
    await recordActivity(
      {
        kind: "contribution.resolved",
        lang,
        source: contribution.source,
        subject: String(id),
        actorId: userId,
        detail: { status: "accepted", key: contribution.key, correction: true },
      },
      client,
    );
    await client.query("commit");
    return { ok: true, contribution: updated.rows[0] };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

type EnglishRow = Pick<CorpusLine, "lineId" | "source" | "questId" | "questTitle" | "playerGender" | "fileName"> & {
  origin: string;
};

/**
 * An English correction, written to every line the moment has: a `:m`/`:f` pair is two files,
 * and an override on one of them would leave the other reader the old text. Each line is
 * given the template as its reader hears it.
 *
 * A template without `$G` for a moment split by player gender is refused: the client resolves
 * `$G` before sending (Contribute.lua's Detemplate does not restore it) and the envelope does
 * not say which reader sent it, so the text is one side's words with no telling which.
 *
 * A template with `$G` where the moment is one plain line cannot be an override: one file
 * cannot say both. The line is split instead (splitByPlayerGender), but only one the site
 * wrote. An extracted line comes back from the next dump import under its plain id, current
 * again beside the split.
 */
async function correctEnglish(
  moment: string,
  variant: number,
  template: string,
  contributionId: number,
  userId: string,
): Promise<Extract<CorrectionOutcome, { ok: false }> | null> {
  const { rows } = await db().query<EnglishRow>(
    `select "lineId", "source", "questId", "questTitle", "playerGender", "fileName", "origin"
       from "quest_line"
      where ${answersQuestMomentSql(`"lineId"`, "$1")} and "variant" = $2 and "lang" = $3 and "isCurrent"
      order by "lineId"`,
    [moment, variant, BASE_LANG],
  );
  if (rows.length === 0) {
    return { ok: false, reason: "not-a-correction", message: `${moment} is not a line the corpus has` };
  }

  const spoken = spokenFromTemplate(template);
  const gendered = branchesOnPlayerGender(spoken);
  const split = rows.some((row) => row.playerGender !== null);
  if (split && !gendered) {
    return {
      ok: false,
      reason: "malformed",
      message: "This line has a side for each player gender, and the correction is one player's words. Edit it in the explorer.",
    };
  }
  const splitting = gendered && !split;
  if (splitting && rows.some((row) => row.origin === "extracted")) {
    return {
      ok: false,
      reason: "malformed",
      message: "This line came from the game data as one recording for every player, so it cannot be split by $g here.",
    };
  }
  // Every form checked before any is written, so a refusal leaves no reader with the new text.
  const forms = splitting
    ? playerGenderForms(rows[0].lineId, rows[0].fileName, true).map((form) => ({ ...rows[0], ...form }))
    : rows;
  const drafts = forms.map((row) =>
    validateOverride({
      file: audioRelPath(row),
      lineId: row.lineId,
      text: speakPlayerTokens(spoken, BASE_LANG, row.playerGender),
    }),
  );

  if (splitting) await splitByPlayerGender(rows[0], forms, variant, template, contributionId, userId);
  else for (const draft of drafts) await writeOverride(draft.file, draft.lineId, draft.text, userId, contributionId);
  return null;
}

/**
 * A plain English line made the moment's `:m` and `:f` lines, as accept.ts writes a contributed
 * moment whose template branches: `text` keeps the `$G` for player-words.ts to resolve in each
 * line's gender. The plain line stops being current; its takes stay under its own file.
 *
 * The plain line's speakers, in every language, are copied onto both, because the export joins
 * speakers to lines by id.
 */
async function splitByPlayerGender(
  plain: EnglishRow,
  forms: readonly EnglishRow[],
  variant: number,
  template: string,
  contributionId: number,
  userId: string,
): Promise<void> {
  const note = correctionNote(contributionId);
  const text = spokenFromTemplate(template);
  const client = await db().connect();
  try {
    await client.query("begin");
    const { rowCount } = await client.query(
      `update "quest_line" set "isCurrent" = false
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [plain.lineId, variant, BASE_LANG],
    );
    if (!rowCount) throw new QuestTextConflict(`${plain.lineId} changed while the correction was accepted`);

    for (const form of forms) {
      const skipReason = skipReasonFor(plain.source, text, BASE_LANG, form.playerGender);
      const { rows } = await client.query<{ version: number }>(
        `insert into "quest_line"
           ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
            "questTitle", "playerGender", "fileName", "text", "originalText", "generatable",
            "skipReason", "editedBy", "note")
         select $1, $2, $3, coalesce(max("version"), 0) + 1, true, 'contributed', $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14
           from "quest_line" where "lineId" = $1 and "variant" = $2 and "lang" = $3
         returning "version"`,
        [
          form.lineId, variant, BASE_LANG, plain.source, plain.questId, plain.questTitle, form.playerGender,
          form.fileName, text, template, skipReason === null, skipReason, userId, note,
        ],
      );
      await recordActivity(
        {
          kind: "text.edited",
          lang: BASE_LANG,
          actorId: userId,
          source: "quests",
          subject: form.lineId,
          lineId: form.lineId,
          detail: { version: rows[0].version, text, note, variant, replaces: [plain.lineId], contribution: contributionId },
        },
        client,
      );
    }

    // One writer at a time past this point, so no two inserts pick the same `ord` (accept.ts).
    // Within the statement the max is read once, so row_number spaces the copies apart.
    await client.query(`select pg_advisory_xact_lock(hashtext('quest_line_speaker.contributed_ord'))`);
    await client.query(
      `insert into "quest_line_speaker"
         ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender",
          "flavor", "voice", "contributionId")
       select f."lineId", s."variant", s."lang",
              greatest((select coalesce(max(o."ord") + 1, 0) from "quest_line_speaker" o where o."lang" = s."lang"), $3)
                + row_number() over (partition by s."lang" order by f."lineId", s."ord", s."id") - 1,
              s."npcType", s."npcId", s."npcName", s."race", s."gender", s."flavor", s."voice", s."contributionId"
         from "quest_line_speaker" s cross join unnest($4::text[]) as f ("lineId")
        where s."lineId" = $1 and s."variant" = $2`,
      [plain.lineId, variant, CONTRIBUTED_ORD_FLOOR, forms.map((form) => form.lineId)],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

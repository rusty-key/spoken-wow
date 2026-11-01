/**
 * Writing one moment's text across every line it has, whichever way it is written.
 *
 * A `:m`/`:f` pair is two files, and text on one of them would leave the other reader the old
 * words, so each line is given the text as its reader hears it. Text that branches on `$G` where
 * the moment is one plain line cannot be one file's: the line is split instead, extracted or not.
 * The site is the corpus; the dump import records an extracted line the site has split without
 * making it current again (pipelines/quests/tts_cli/corpus_db.py).
 */
import "server-only";

import type { PoolClient } from "pg";

import { recordActivity } from "@/lib/activity/store";
import { audioRelPath } from "@/lib/audio";
import { answersQuestMomentSql, baseLineId, momentOf, playerGenderForms } from "@/lib/contributions/naming";
import type { CorpusLine } from "@/lib/corpus";
import { db, withTeam } from "@/lib/db";
import { ownerOrAll } from "@/lib/teams/store";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { branchesOnPlayerGender, playerGenderSides, speakPlayerTokens } from "@/lib/player-words";
import { validateOverride } from "@/lib/quests/override";
import { writeOverride } from "@/lib/quests/overrides";
import { lockLine, ORD_FLOOR } from "@/lib/quests/speakers";
import { QuestTextConflict, saveQuestText } from "@/lib/quests/text";
import { skipReasonFor } from "@/lib/text-gate";

type MomentRow = Pick<
  CorpusLine,
  "lineId" | "source" | "questId" | "questTitle" | "playerGender" | "fileName" | "originalText"
> & { text: string };

/**
 * A moment's current lines in `lang`: its plain line, or its `:m` and `:f`. Any of the moment's
 * ids finds them, a side's or a voice's (`{lineId}~{voice}`) included.
 */
export async function momentLines(lang: Lang, lineId: string, variant: number): Promise<MomentRow[]> {
  const moment = momentOf(baseLineId(lineId));
  const { rows } = await db().query<MomentRow>(
    `select "lineId", "source", "questId", "questTitle", "playerGender", "fileName", "originalText", "text"
       from "quest_line"
      where ${answersQuestMomentSql(`"lineId"`, "$1")} and "variant" = $2 and "lang" = $3 and "isCurrent"
      order by "lineId"`,
    [moment, variant, lang],
  );
  return rows;
}

/** Each line the text lands on, in its reader's words, every one checked before any is written. */
function draftsFor(lang: Lang, rows: readonly MomentRow[], text: string) {
  const split = rows.length === 1 && rows[0].playerGender === null && branchesOnPlayerGender(text);
  const forms = split
    ? playerGenderForms(rows[0].lineId, rows[0].fileName, true).map((form) => ({ ...rows[0], ...form }))
    : rows;
  const [male, female] = playerGenderSides(text);
  const drafts = forms.map((row) => {
    // English is stored spoken. A translation keeps its tokens for player-words.ts, which says them
    // at the point of sending, so a change to its words reaches this line too.
    const side = row.playerGender === "f" ? female : row.playerGender === "m" ? male : text;
    const draft = validateOverride(
      {
        file: audioRelPath(row),
        lineId: row.lineId,
        text: lang === BASE_LANG ? speakPlayerTokens(text, lang, row.playerGender) : side,
      },
      lang,
    );
    return { ...row, file: draft.file, text: draft.text, current: row.text };
  });
  return { split, drafts };
}

/** What a voice maintainer's dialog saves when the text branches on `$G`. The files it changed. */
export async function rewriteMoment(
  lang: Lang,
  rows: readonly MomentRow[],
  variant: number,
  rewrite: { text: string; userId: string },
): Promise<string[]> {
  const { split, drafts } = draftsFor(lang, rows, rewrite.text);
  if (!split) {
    for (const draft of drafts) await writeOverride(lang, draft.file, draft.lineId, draft.text, rewrite.userId);
  } else if (lang === BASE_LANG) {
    await splitEnglish(rows[0], drafts, variant, rewrite.userId);
  } else {
    // Splitting makes the lines and their files, which no override can.
    await saveQuestText({ lineId: rows[0].lineId, variant, lang, text: rewrite.text, editedBy: rewrite.userId });
  }
  return drafts.map((draft) => draft.file);
}

type Correction = {
  /** What a split's lines print: the correction's template. */
  originalText: string;
  contributionId: number;
  note: string;
};

/**
 * An accepted correction: new versions of what English's corpus says. The same text again spends
 * no version.
 *
 * `edited`, not `contributed`, for a line that stays itself: the dump import keeps only an edited
 * line, and would put its own text back over any other. A split's lines are safe from it either way.
 */
export async function writeEnglishOriginal(
  rows: readonly MomentRow[],
  variant: number,
  text: string,
  userId: string,
  correction: Correction,
): Promise<void> {
  const { split, drafts } = draftsFor(BASE_LANG, rows, text);
  if (split) return splitEnglish(rows[0], drafts, variant, userId, correction);
  const changed = drafts.filter((draft) => draft.text !== draft.current);
  if (!changed.length) return;
  const retired = changed.map((form) => form.lineId);
  await inMoment(retired, variant, (client) =>
    insertVersions(client, changed, variant, { userId, origin: "edited", correction }),
  );
}

/**
 * A plain English line made the moment's `:m` and `:f` lines, each holding its own reader's
 * words: the `$G` branches are taken here, not left for player-words.ts. The plain line stops
 * being current; its takes stay under its own file.
 */
async function splitEnglish(
  plain: MomentRow,
  drafts: readonly MomentRow[],
  variant: number,
  userId: string,
  correction?: Correction,
): Promise<void> {
  const forms = drafts.map((form) => ({ ...form, originalText: correction?.originalText ?? form.originalText }));
  await inMoment([plain.lineId], variant, async (client) => {
    await insertVersions(client, forms, variant, {
      userId,
      origin: correction ? "contributed" : "edited",
      correction,
      replaces: [plain.lineId],
    });
    await copySpeakers(client, plain.lineId, variant, forms.map((form) => form.lineId));
  });
}

/** `retired` stop being current under the moment's lock, then `write` runs in that transaction. */
async function inMoment(
  retired: string[],
  variant: number,
  write: (client: PoolClient) => Promise<void>,
): Promise<void> {
  return withTeam(await ownerOrAll(BASE_LANG), async (client) => {
    // A speaker added meanwhile would reach the plain line only, after the copies were taken.
    await lockLine(client, momentOf(retired[0]));
    const { rowCount } = await client.query(
      `update "quest_line" set "isCurrent" = false
        where "lineId" = any($1::text[]) and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [retired, variant, BASE_LANG],
    );
    if (rowCount !== retired.length) throw new QuestTextConflict(`${retired[0]} changed while it was being written`);
    await write(client);
  });
}

async function insertVersions(
  client: PoolClient,
  forms: readonly MomentRow[],
  variant: number,
  write: { userId: string; origin: "edited" | "contributed"; correction?: Correction; replaces?: string[] },
): Promise<void> {
  const { userId, origin, correction, replaces } = write;
  for (const form of forms) {
    const { text } = form;
    const skipReason = skipReasonFor(form.source, text, BASE_LANG, form.playerGender);
    const { rows } = await client.query<{ version: number }>(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
          "questTitle", "playerGender", "fileName", "text", "originalText", "generatable",
          "skipReason", "editedBy", "note")
       select $1, $2, $3, coalesce(max("version"), 0) + 1, true, $4, $5, $6, $7, $8, $9,
              $10, $11, $12, $13, $14, $15
         from "quest_line" where "lineId" = $1 and "variant" = $2 and "lang" = $3
       returning "version"`,
      [
        form.lineId, variant, BASE_LANG, origin, form.source, form.questId, form.questTitle,
        form.playerGender, form.fileName, text, form.originalText, skipReason === null,
        skipReason, userId, correction?.note ?? null,
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
        detail: {
          version: rows[0].version,
          text,
          note: correction?.note ?? null,
          variant,
          ...(replaces ? { replaces } : {}),
          ...(correction ? { contribution: correction.contributionId } : {}),
        },
      },
      client,
    );
  }
}

/**
 * The plain line's speakers, in every language, onto each side, because the export joins speakers
 * to lines by id.
 */
async function copySpeakers(client: PoolClient, plain: string, variant: number, sides: string[]): Promise<void> {
  // One writer at a time past this point, so no two inserts pick the same `ord`.
  // Within the statement the max is read once, so row_number spaces the copies apart.
  await client.query(`select pg_advisory_xact_lock(hashtext('quest_line_speaker.contributed_ord'))`);
  await client.query(
    `insert into "quest_line_speaker"
       ("lineId", "variant", "lang", "ord", "npcType", "npcId", "npcName", "race", "gender",
        "flavor", "voice", "contributionId", "addedBy")
     select f."lineId", s."variant", s."lang",
            greatest((select coalesce(max(o."ord") + 1, 0) from "quest_line_speaker" o where o."lang" = s."lang"), $3)
              + row_number() over (partition by s."lang" order by f."lineId", s."ord", s."id") - 1,
            s."npcType", s."npcId", s."npcName", s."race", s."gender", s."flavor", s."voice", s."contributionId", s."addedBy"
       from "quest_line_speaker" s cross join unnest($4::text[]) as f ("lineId")
      where s."lineId" = $1 and s."variant" = $2`,
    [plain, variant, ORD_FLOOR, sides],
  );
}

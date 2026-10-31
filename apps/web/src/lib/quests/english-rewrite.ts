/**
 * Rewriting what an English moment speaks, on every line it has: the explorer's override
 * dialog and an accepted correction (contributions/correction.ts) both end here.
 *
 * A `:m`/`:f` pair is two files, and an override on one of them would leave the other reader
 * the old text, so each line is given the text as its reader hears it. Text that branches on
 * `$G` where the moment is one plain line cannot be an override, since one file cannot say
 * both: the line is split instead, extracted or not. The site is the corpus; the dump import
 * records an extracted line the site has split without making it current again
 * (pipelines/quests/tts_cli/corpus_db.py).
 */
import "server-only";

import { recordActivity } from "@/lib/activity/store";
import { audioRelPath } from "@/lib/audio";
import { answersQuestMomentSql, baseLineId, momentOf, playerGenderForms } from "@/lib/contributions/naming";
import type { CorpusLine } from "@/lib/corpus";
import { db } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { branchesOnPlayerGender, speakPlayerTokens } from "@/lib/player-words";
import { validateOverride } from "@/lib/quests/override";
import { writeOverride } from "@/lib/quests/overrides";
import { lockLine, ORD_FLOOR } from "@/lib/quests/speakers";
import { QuestTextConflict } from "@/lib/quests/text";
import { skipReasonFor } from "@/lib/text-gate";

type EnglishRow = Pick<
  CorpusLine,
  "lineId" | "source" | "questId" | "questTitle" | "playerGender" | "fileName" | "originalText"
>;

/**
 * A moment's current English lines: its plain line, or its `:m` and `:f`. Any of the moment's
 * ids finds them, a side's or a voice's (`{lineId}~{voice}`) included.
 */
export async function englishMomentLines(lineId: string, variant: number): Promise<EnglishRow[]> {
  const moment = momentOf(baseLineId(lineId));
  const { rows } = await db().query<EnglishRow>(
    `select "lineId", "source", "questId", "questTitle", "playerGender", "fileName", "originalText"
       from "quest_line"
      where ${answersQuestMomentSql(`"lineId"`, "$1")} and "variant" = $2 and "lang" = $3 and "isCurrent"
      order by "lineId"`,
    [moment, variant, BASE_LANG],
  );
  return rows;
}

export type EnglishRewrite = {
  /** The spoken text, `$G` branches and all. */
  text: string;
  /** What the split lines print, when this splits: a correction's template, or the plain line's own. */
  originalText?: string;
  userId: string;
  contributionId?: number;
  note?: string | null;
};

/** Whether it split the moment, and the files whose text it changed. */
export async function rewriteEnglish(
  rows: readonly EnglishRow[],
  variant: number,
  rewrite: EnglishRewrite,
): Promise<{ split: boolean; files: string[] }> {
  const split = rows.length === 1 && rows[0].playerGender === null && branchesOnPlayerGender(rewrite.text);
  const forms = split
    ? playerGenderForms(rows[0].lineId, rows[0].fileName, true).map((form) => ({ ...rows[0], ...form }))
    : rows;
  // Every form checked before any is written, so a refusal leaves no reader with the new text.
  const drafts = forms.map((row) =>
    validateOverride({
      file: audioRelPath(row),
      lineId: row.lineId,
      text: speakPlayerTokens(rewrite.text, BASE_LANG, row.playerGender),
    }),
  );

  if (split) {
    const sides = forms.map((form, i) => ({ ...form, text: drafts[i].text }));
    await splitByPlayerGender(rows[0], sides, variant, rewrite);
  } else {
    for (const draft of drafts) {
      await writeOverride(draft.file, draft.lineId, draft.text, rewrite.userId, rewrite.contributionId);
    }
  }
  return { split, files: drafts.map((draft) => draft.file) };
}

/**
 * A plain English line made the moment's `:m` and `:f` lines, each holding its own reader's
 * words: the `$G` branches are taken here, not left for player-words.ts. The plain line stops
 * being current; its takes stay under its own file.
 *
 * The plain line's speakers, in every language, are copied onto both, because the export joins
 * speakers to lines by id.
 */
async function splitByPlayerGender(
  plain: EnglishRow,
  forms: readonly (EnglishRow & { text: string })[],
  variant: number,
  rewrite: EnglishRewrite,
): Promise<void> {
  const originalText = rewrite.originalText ?? plain.originalText;
  const origin = rewrite.contributionId === undefined ? "edited" : "contributed";
  const client = await db().connect();
  try {
    await client.query("begin");
    // The moment's lock, as addToMoment's writers hold it: a speaker added meanwhile would
    // reach the plain line only, after the copies were taken.
    await lockLine(client, momentOf(plain.lineId));
    const { rowCount } = await client.query(
      `update "quest_line" set "isCurrent" = false
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [plain.lineId, variant, BASE_LANG],
    );
    if (!rowCount) throw new QuestTextConflict(`${plain.lineId} changed while it was being split`);

    for (const form of forms) {
      const { text } = form;
      const skipReason = skipReasonFor(plain.source, text, BASE_LANG, form.playerGender);
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
          form.lineId, variant, BASE_LANG, origin, plain.source, plain.questId, plain.questTitle,
          form.playerGender, form.fileName, text, originalText, skipReason === null,
          skipReason, rewrite.userId, rewrite.note ?? null,
        ],
      );
      await recordActivity(
        {
          kind: "text.edited",
          lang: BASE_LANG,
          actorId: rewrite.userId,
          source: "quests",
          subject: form.lineId,
          lineId: form.lineId,
          detail: {
            version: rows[0].version,
            text,
            note: rewrite.note ?? null,
            variant,
            replaces: [plain.lineId],
            ...(rewrite.contributionId === undefined ? {} : { contribution: rewrite.contributionId }),
          },
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
          "flavor", "voice", "contributionId", "addedBy")
       select f."lineId", s."variant", s."lang",
              greatest((select coalesce(max(o."ord") + 1, 0) from "quest_line_speaker" o where o."lang" = s."lang"), $3)
                + row_number() over (partition by s."lang" order by f."lineId", s."ord", s."id") - 1,
              s."npcType", s."npcId", s."npcName", s."race", s."gender", s."flavor", s."voice", s."contributionId", s."addedBy"
         from "quest_line_speaker" s cross join unnest($4::text[]) as f ("lineId")
        where s."lineId" = $1 and s."variant" = $2`,
      [plain.lineId, variant, ORD_FLOOR, forms.map((form) => form.lineId)],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

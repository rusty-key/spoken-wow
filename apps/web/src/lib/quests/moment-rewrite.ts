/**
 * Writing one moment's text across every line it has, whichever way it is written.
 *
 * A `:m`/`:f` pair is two files, and text on one of them would leave the other reader the old
 * words, so each line is given the text as its reader hears it. Text that branches on `$G` where
 * the moment is one plain line cannot be one file's: the line is split instead, extracted or not.
 * The site is the corpus; the dump import records an extracted line the site has split without
 * making it current again (pipelines/quests/tts_cli/corpus_db.py).
 *
 * Two entry points: rewriteMoment is what a voice maintainer says for the team (line_override), and
 * writeEnglishOriginal changes what English's corpus says, for an accepted correction. Another
 * language's original is saveQuestText's.
 */
import "server-only";

import { recordActivity } from "@/lib/activity/store";
import { audioRelPath } from "@/lib/audio";
import { answersQuestMomentSql, baseLineId, momentOf, playerGenderForms } from "@/lib/contributions/naming";
import type { CorpusLine } from "@/lib/corpus";
import { db, withTeam } from "@/lib/db";
import { ownerOrAll } from "@/lib/teams/store";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { branchesOnPlayerGender, speakPlayerTokens } from "@/lib/player-words";
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

/** Whether it split the moment, and the files whose text it changed. */
type Rewritten = { split: boolean; files: string[] };

/** Each line the text lands on, in its reader's words, every one checked before any is written. */
function draftsFor(lang: Lang, rows: readonly MomentRow[], text: string) {
  const split = rows.length === 1 && rows[0].playerGender === null && branchesOnPlayerGender(text);
  const forms = split
    ? playerGenderForms(rows[0].lineId, rows[0].fileName, true).map((form) => ({ ...rows[0], ...form }))
    : rows;
  const drafts = forms.map((row) => {
    const draft = validateOverride(
      { file: audioRelPath(row), lineId: row.lineId, text: speakPlayerTokens(text, lang, row.playerGender) },
      lang,
    );
    return { ...row, file: draft.file, text: draft.text, current: row.text };
  });
  return { split, drafts };
}

/** What a voice maintainer's dialog saves when the text branches on `$G`. */
export async function rewriteMoment(
  lang: Lang,
  rows: readonly MomentRow[],
  variant: number,
  rewrite: { text: string; userId: string },
): Promise<Rewritten> {
  const { split, drafts } = draftsFor(lang, rows, rewrite.text);
  const files = drafts.map((draft) => draft.file);
  if (!split) {
    for (const draft of drafts) await writeOverride(lang, draft.file, draft.lineId, draft.text, rewrite.userId);
  } else if (lang === BASE_LANG) {
    await writeEnglish(rows[0], drafts, variant, { ...rewrite, split: true });
  } else {
    // Splitting makes the lines and their files, which no override can.
    await saveQuestText({ lineId: rows[0].lineId, variant, lang, text: rewrite.text, editedBy: rewrite.userId });
  }
  return { split, files };
}

export type EnglishOriginal = {
  /** The spoken text, `$G` branches and all. */
  text: string;
  /** What a split's lines print: the correction's template. */
  originalText: string;
  userId: string;
  contributionId: number;
  note: string;
};

/**
 * An accepted correction: new versions of what English's corpus says, as another language's
 * corrections are. The same text again spends no version.
 */
export async function writeEnglishOriginal(
  rows: readonly MomentRow[],
  variant: number,
  original: EnglishOriginal,
): Promise<Rewritten> {
  const { split, drafts } = draftsFor(BASE_LANG, rows, original.text);
  const files = drafts.map((draft) => draft.file);
  const changed = split ? drafts : drafts.filter((draft) => draft.text !== draft.current);
  if (changed.length) await writeEnglish(rows[0], changed, variant, { ...original, split });
  return { split, files };
}

/**
 * `edited`, not `contributed`, for a line that stays itself: the dump import keeps only an edited
 * line, and would put its own text back over any other. A split's lines are safe from it either way.
 */
async function writeEnglish(
  first: MomentRow,
  forms: readonly (MomentRow & { text: string })[],
  variant: number,
  write: {
    split: boolean;
    userId: string;
    originalText?: string;
    contributionId?: number;
    note?: string;
  },
): Promise<void> {
  const origin = write.split && write.contributionId !== undefined ? "contributed" : "edited";
  const retired = write.split ? [first.lineId] : forms.map((form) => form.lineId);
  return withTeam(await ownerOrAll(BASE_LANG), async (client) => {
    // The moment's lock, as addToMoment's writers hold it: a speaker added meanwhile would
    // reach the plain line only, after the copies were taken.
    await lockLine(client, momentOf(first.lineId));
    const { rowCount } = await client.query(
      `update "quest_line" set "isCurrent" = false
        where "lineId" = any($1::text[]) and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [retired, variant, BASE_LANG],
    );
    if (rowCount !== retired.length) throw new QuestTextConflict(`${first.lineId} changed while it was being written`);

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
          form.playerGender, form.fileName, text, (write.split && write.originalText) || form.originalText,
          skipReason === null, skipReason, write.userId, write.note ?? null,
        ],
      );
      await recordActivity(
        {
          kind: "text.edited",
          lang: BASE_LANG,
          actorId: write.userId,
          source: "quests",
          subject: form.lineId,
          lineId: form.lineId,
          detail: {
            version: rows[0].version,
            text,
            note: write.note ?? null,
            variant,
            ...(write.split ? { replaces: [first.lineId] } : {}),
            ...(write.contributionId === undefined ? {} : { contribution: write.contributionId }),
          },
        },
        client,
      );
    }

    if (!write.split) return;

    // The plain line's speakers, in every language, are copied onto both, because the export
    // joins speakers to lines by id. One writer at a time past this point, so no two inserts pick
    // the same `ord` (accept.ts).
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
      [first.lineId, variant, ORD_FLOOR, forms.map((form) => form.lineId)],
    );
  });
}

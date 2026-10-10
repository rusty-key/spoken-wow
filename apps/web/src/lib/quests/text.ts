/**
 * Writing a quest line's text in a language other than English: new quest_line versions,
 * the way lib/books/text.ts writes pages and lib/zones/lore.ts writes lore.
 *
 * English is not written here. Its spoken rewrites are line_override's -- keyed by file,
 * with the committed corpus and its export behind them -- and moving English onto versions
 * is a change to how every English pack is built, which this is not. Another language has
 * no such history to keep, so its text is simply a versioned row like every other.
 *
 * A line is addressed by its id and variant, because 103 ids name two different texts. The
 * first translation of a line copies its structure -- event, quest, file, player gender --
 * from the English row, since none of that differs by language, and every later one from
 * the row it replaces. What the client shows (localeText) is carried along untouched: an
 * edit changes what is spoken, not what the game prints.
 */
import "server-only";

import { recordActivity } from "@/lib/activity/store";
import { db, query } from "@/lib/db";
import { answersQuestMomentSql, baseLineId, momentOf, playerGenderForms } from "@/lib/contributions/naming";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { branchesOnPlayerGender } from "@/lib/player-words";
import { skipReasonFor } from "@/lib/text-gate";

export type QuestTextVersion = {
  lineId: string;
  variant: number;
  version: number;
  isCurrent: boolean;
  origin: "extracted" | "edited" | "contributed" | "community";
  text: string;
  editedBy: string | null;
  note: string | null;
  createdAt: string;
};

type Row = Omit<QuestTextVersion, "createdAt"> & { createdAt: Date };

/** What a new version copies from the row it replaces, or from the English for a first one. */
const STRUCTURE = `"source", "questId", "playerGender", "fileName", "originalText", "localeText"`;
type Structure = Row & {
  source: string;
  questId: number | null;
  playerGender: "m" | "f" | null;
  fileName: string;
  originalText: string;
  localeText: string | null;
};

const COLUMNS = `"lineId", "variant", "version", "isCurrent", "origin", "text", "editedBy",
                 "note", "createdAt"`;

function toVersion(row: Row): QuestTextVersion {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export class QuestTextConflict extends Error {}
export class QuestTextMissing extends Error {}

function refuseEnglish(lang: Lang): void {
  if (lang === BASE_LANG) {
    throw new Error("English lines are rewritten through line_override, not here");
  }
}

export async function questTextHistory(
  lineId: string,
  variant: number,
  lang: Lang,
): Promise<QuestTextVersion[]> {
  lineId = baseLineId(lineId);
  const rows = await query<Row>(
    `select ${COLUMNS} from "quest_line"
      where "lineId" = $1 and "variant" = $2 and "lang" = $3
      order by "version" desc`,
    [lineId, variant, lang],
  );
  return rows.map(toVersion);
}

/**
 * Save a line's text as a new live version.
 *
 * `expectedVersion` is optimistic concurrency, as for a page: two translators on one line
 * would otherwise overwrite each other, and a 409 is what the second one can act on.
 *
 * THE TEXT DECIDES THE LINES, as it does on import and accept: a text that branches on the
 * player's gender (`$G`) is written to the moment's `:m` and `:f` lines, and a plain line given
 * one is split in two, the plain line no longer current. A side of a moment already split is
 * edited alone while the text has no `$G`, since an imported side holds its own branch, already
 * resolved. Putting a plain version back undoes a split (restoreQuestText).
 */
export async function saveQuestText(args: {
  lineId: string;
  variant: number;
  lang: Lang;
  text: string;
  note?: string | null;
  editedBy: string;
  expectedVersion?: number | null;
  /** The contribution the text came from, for a correction accepted from the game. */
  contribution?: number;
}): Promise<QuestTextVersion> {
  refuseEnglish(args.lang);
  args = { ...args, lineId: baseLineId(args.lineId) };
  const text = args.text.trim();
  if (!text) throw new Error("the text cannot be empty");
  const moment = momentOf(args.lineId);

  const client = await db().connect();
  try {
    await client.query("begin");

    // Every current row of the moment in this language, so a split can retire the others.
    const { rows: momentRows } = await client.query<Structure>(
      `select ${COLUMNS}, ${STRUCTURE} from "quest_line"
        where ${answersQuestMomentSql(`"lineId"`, "$1")} and "variant" = $2 and "lang" = $3 and "isCurrent"
        for update`,
      [moment, args.variant, args.lang],
    );
    const current = momentRows.find((row) => row.lineId === args.lineId);

    const { rows: englishRows } = await client.query<Structure>(
      `select ${COLUMNS}, ${STRUCTURE} from "quest_line"
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [args.lineId, args.variant, BASE_LANG],
    );
    // Structure from the row being replaced, or from the English one for a first translation.
    // A line only this language has has no English row, but always has a current one.
    const from = current ?? englishRows[0];
    if (!from) throw new QuestTextMissing(`${args.lineId} is not a line the corpus has`);

    if (
      current &&
      args.expectedVersion !== undefined &&
      args.expectedVersion !== null &&
      args.expectedVersion !== current.version
    ) {
      throw new QuestTextConflict(
        `this line moved to v${current.version} while you were editing it`,
      );
    }

    const split = momentRows.some((row) => row.playerGender !== null);
    const plainFile = from.playerGender ? from.fileName.slice(2) : from.fileName;
    const targets =
      split && from.playerGender && !branchesOnPlayerGender(text, args.lang)
        ? [{ lineId: from.lineId, fileName: from.fileName, playerGender: from.playerGender }]
        : playerGenderForms(moment, plainFile, branchesOnPlayerGender(text, args.lang));
    const written = targets.map((target) => target.lineId);
    // The plain line a split replaces.
    const retired = momentRows
      .filter((row) => (row.playerGender !== null) !== (targets[0].playerGender !== null))
      .map((row) => row.lineId);

    // A save that changes nothing must not spend a version number.
    if (
      !retired.length &&
      targets.every((target) => momentRows.some((row) => row.lineId === target.lineId && row.text === text))
    ) {
      await client.query("commit");
      return toVersion(momentRows.find((row) => row.lineId === written[0])!);
    }

    await client.query(
      `update "quest_line" set "isCurrent" = false
        where "lineId" = any($1::text[]) and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [[...written, ...retired], args.variant, args.lang],
    );

    let saved: Row | undefined;
    for (const target of targets) {
      const own = momentRows.find((row) => row.lineId === target.lineId);
      const { rows: maxRows } = await client.query<{ version: string }>(
        `select coalesce(max("version"), 0) as "version" from "quest_line"
          where "lineId" = $1 and "variant" = $2 and "lang" = $3`,
        [target.lineId, args.variant, args.lang],
      );
      const version = Number(maxRows[0].version) + 1;
      // Whether the line can be voiced is decided from the text now being written, by the
      // same rules the English uses: progress text never is, and a stray bracket or a token
      // this language has no word for would be read aloud. Its $N does have one
      // (player-words.ts), in the form the line's player gender takes.
      const skipReason = skipReasonFor(from.source, text, args.lang, target.playerGender);
      const source = own ?? from;
      // localeText from the language's own row only, since the English has none.
      const { rows: inserted } = await client.query<Row>(
        `insert into "quest_line"
           ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
            "questTitle", "playerGender", "fileName", "text", "originalText", "localeText",
            "generatable", "skipReason", "editedBy", "note")
         values ($1, $2, $3, $4, true, 'edited', $5, $6, null, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning ${COLUMNS}`,
        [
          target.lineId,
          args.variant,
          args.lang,
          version,
          source.source,
          source.questId,
          target.playerGender,
          target.fileName,
          text,
          source.originalText,
          (own ?? current)?.localeText ?? null,
          skipReason === null,
          skipReason,
          args.editedBy,
          args.note?.trim() || null,
        ],
      );
      saved ??= inserted[0];
      await recordActivity(
        {
          kind: "text.edited",
          lang: args.lang,
          actorId: args.editedBy,
          source: "quests",
          subject: target.lineId,
          lineId: target.lineId,
          detail: {
            version,
            text,
            note: args.note?.trim() || null,
            variant: args.variant,
            ...(retired.length ? { replaces: retired } : {}),
            ...(args.contribution ? { contribution: args.contribution } : {}),
          },
        },
        client,
      );
    }

    await client.query("commit");
    return toVersion(saved!);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Put an earlier version back, by moving the live flag. No new row: see restoreBookText.
 *
 * `by` is who asked, for the activity log: moving the flag writes nothing that names them,
 * so the log is the only record of who put an old text back.
 */
export async function restoreQuestText(
  lineId: string,
  variant: number,
  lang: Lang,
  version: number,
  by: string | null,
): Promise<QuestTextVersion> {
  refuseEnglish(lang);
  const client = await db().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<Row>(
      `select ${COLUMNS} from "quest_line"
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "version" = $4 for update`,
      [lineId, variant, lang, version],
    );
    if (!rows[0]) throw new QuestTextMissing(`${lineId} has no version ${version} in ${lang}`);
    // A moment is one plain line or two gendered ones, never both. Putting a plain version back
    // undoes a split; one side alone cannot undo a merge, so that asks for the $G instead.
    const moment = momentOf(lineId);
    const { rows: others } = await client.query<{ lineId: string }>(
      `select "lineId" from "quest_line"
        where ${answersQuestMomentSql(`"lineId"`, "$1")} and "lineId" <> $2
          and "variant" = $3 and "lang" = $4 and "isCurrent"`,
      [moment, lineId, variant, lang],
    );
    if (lineId !== moment && others.some((row) => row.lineId === moment)) {
      throw new QuestTextConflict("this line is one for every player now: write its $G again to split it");
    }
    const { rows: was } = await client.query<{ version: number }>(
      `update "quest_line" set "isCurrent" = false
        where "lineId" = any($1::text[]) and "variant" = $2 and "lang" = $3 and "isCurrent"
        returning "version"`,
      [lineId === moment ? [lineId, ...others.map((row) => row.lineId)] : [lineId], variant, lang],
    );
    const { rows: restored } = await client.query<Row>(
      `update "quest_line" set "isCurrent" = true
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "version" = $4
       returning ${COLUMNS}`,
      [lineId, variant, lang, version],
    );
    await recordActivity(
      {
        kind: "text.restored",
        lang,
        actorId: by,
        source: "quests",
        subject: lineId,
        lineId,
        detail: { version, from: was[0]?.version ?? null },
      },
      client,
    );
    await client.query("commit");
    return toVersion(restored[0]);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

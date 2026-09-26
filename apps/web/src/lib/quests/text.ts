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
import { BASE_LANG, type Lang } from "@/lib/lang";
import { skipReasonFor } from "@/lib/text-gate";

export type QuestTextVersion = {
  lineId: string;
  variant: number;
  version: number;
  isCurrent: boolean;
  origin: "extracted" | "edited";
  text: string;
  editedBy: string | null;
  note: string | null;
  createdAt: string;
};

type Row = Omit<QuestTextVersion, "createdAt"> & { createdAt: Date };

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
 */
export async function saveQuestText(args: {
  lineId: string;
  variant: number;
  lang: Lang;
  text: string;
  note?: string | null;
  editedBy: string;
  expectedVersion?: number | null;
}): Promise<QuestTextVersion> {
  refuseEnglish(args.lang);
  const text = args.text.trim();
  if (!text) throw new Error("the text cannot be empty");

  const client = await db().connect();
  try {
    await client.query("begin");

    const { rows: currentRows } = await client.query<Row & { source: string }>(
      `select ${COLUMNS}, "source" from "quest_line"
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent" for update`,
      [args.lineId, args.variant, args.lang],
    );
    const current = currentRows[0];

    const { rows: englishRows } = await client.query<{
      version: number;
      source: string;
      playerGender: "m" | "f" | null;
    }>(
      `select "version", "source", "playerGender" from "quest_line"
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [args.lineId, args.variant, BASE_LANG],
    );
    const english = englishRows[0];
    if (!english) throw new QuestTextMissing(`${args.lineId} is not a line the corpus has`);

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

    // A save that changes nothing must not spend a version number.
    if (current && current.text === text) {
      await client.query("commit");
      return toVersion(current);
    }

    const { rows: maxRows } = await client.query<{ version: string }>(
      `select coalesce(max("version"), 0) as "version" from "quest_line"
        where "lineId" = $1 and "variant" = $2 and "lang" = $3`,
      [args.lineId, args.variant, args.lang],
    );
    const version = Number(maxRows[0].version) + 1;

    await client.query(
      `update "quest_line" set "isCurrent" = false
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"`,
      [args.lineId, args.variant, args.lang],
    );

    // Whether the line can be voiced is decided from the text now being written, by the
    // same rules the English uses: a stray bracket or a token
    // this language has no word for would be read aloud. Its $N does have one
    // (player-words.ts), in the form the line's player gender takes.
    const skipReason = skipReasonFor(text, args.lang, english.playerGender);

    // Structure from the row being replaced, or from the English one for a first
    // translation; localeText from the replaced row only, since the English has none.
    const { rows: inserted } = await client.query<Row>(
      `insert into "quest_line"
         ("lineId", "variant", "lang", "version", "isCurrent", "origin", "source", "questId",
          "questTitle", "playerGender", "fileName", "text", "originalText", "localeText",
          "generatable", "skipReason", "editedBy", "note")
       select s."lineId", s."variant", $3, $4, true, 'edited', s."source", s."questId",
              null, s."playerGender", s."fileName", $5, s."originalText",
              (select "localeText" from "quest_line"
                where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "version" = $9),
              $6, $7, $8, $10
         from "quest_line" s
        where s."lineId" = $1 and s."variant" = $2 and s."lang" = $11 and s."version" = $12
       returning ${COLUMNS}`,
      [
        args.lineId,
        args.variant,
        args.lang,
        version,
        text,
        skipReason === null,
        skipReason,
        args.editedBy,
        current?.version ?? null,
        args.note?.trim() || null,
        current ? args.lang : BASE_LANG,
        current ? current.version : english.version,
      ],
    );
    await recordActivity(
      {
        kind: "text.edited",
        lang: args.lang,
        actorId: args.editedBy,
        source: "quests",
        subject: args.lineId,
        lineId: args.lineId,
        detail: { version, text, note: args.note?.trim() || null, variant: args.variant },
      },
      client,
    );

    await client.query("commit");
    return toVersion(inserted[0]);
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
    const { rows: was } = await client.query<{ version: number }>(
      `update "quest_line" set "isCurrent" = false
        where "lineId" = $1 and "variant" = $2 and "lang" = $3 and "isCurrent"
        returning "version"`,
      [lineId, variant, lang],
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

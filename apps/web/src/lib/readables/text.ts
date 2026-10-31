/**
 * A page's words, and the one write that changes them.
 *
 * SERVER ONLY. book_line has been versioned since 0026 -- `origin in ('extracted','edited')`,
 * an editedBy, a note -- and until now nothing wrote an `edited` row: the only way a page's
 * text could change was a re-import from the dump. So a reported mistake in a book could be
 * read, triaged and regenerated, but not actually fixed, which made the report queue a list
 * of things nobody could act on.
 *
 * The places equivalent (lib/places/lore.ts) is the model, down to the optimistic version
 * check, and the differences are the two corpora's own:
 *
 *   * A page has one text, where a zone line has a full and a short.
 *   * The structural fields -- which book, which page number, what opens it -- are copied
 *     from book_page rather than accepted from the caller. Which pages exist is the
 *     extract's business (0026 says so plainly), and an API that let a text edit move a
 *     page to another book would be one bad request away from a page the addon cannot find.
 *
 * EDITING DOES NOT REGENERATE. The new text hashes differently from the take that was
 * spoken, so the page simply reads "audio outdated" and joins the worklist like any other
 * stale line. Coupling a free action to a paid one is how a typo fix ends up costing
 * credits.
 */
import "server-only";

import { recordActivity } from "@/lib/activity/store";
import { actAs, db, query } from "@/lib/db";
import { loggerOf } from "@/lib/teams/store";

import { BASE_LANG, type Lang } from "@/lib/lang";

import { speakPlayerTokens } from "@/lib/player-words";
import { isGeneratable } from "./tools";
import { BOOK_ID_COMPAT, PAGE_COUNT } from "@readables-tools/lib/page.mjs";

export type BookVersion = {
  lineId: string;
  version: number;
  isCurrent: boolean;
  origin: "extracted" | "edited" | "contributed" | "community";
  text: string;
  editedBy: string | null;
  note: string | null;
  createdAt: string;
};

type Row = Omit<BookVersion, "createdAt"> & { createdAt: Date };

const COLUMNS = `"lineId", "version", "isCurrent", "origin", "text", "editedBy", "note",
                 "createdAt"`;

function toVersion(row: Row): BookVersion {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** Somebody else changed this page while the dialog was open. */
export class BookConflict extends Error {}
/** The page is not in the table, which means the corpus has not been imported. */
export class BookMissing extends Error {}

/** Every version of one page, newest first. */
export async function bookHistory(
  lineId: string,
  lang: Lang = BASE_LANG,
): Promise<BookVersion[]> {
  const rows = await query<Row>(
    `select ${COLUMNS} from "book_line"
      where "lineId" = $1 and "lang" = $2
      order by "version" desc`,
    [lineId, lang],
  );
  return rows.map(toVersion);
}

/**
 * Saves a rewritten page as a new live version.
 *
 * `expectedVersion` is optimistic concurrency rather than ceremony: the dialog holds the
 * text it loaded, and two editors on the same page would otherwise silently overwrite each
 * other with a whole page rather than a field. Sending the version the edit started from
 * turns that into a 409 the second person can see.
 */
export async function saveBookText(args: {
  lineId: string;
  text: string;
  note?: string | null;
  editedBy: string;
  expectedVersion?: number | null;
  lang?: Lang;
}): Promise<BookVersion> {
  const lang = args.lang ?? BASE_LANG;
  // Its activity row is the one write a team owns.
  const team = await loggerOf(lang);
  const client = await db().connect();
  try {
    await client.query("begin");
    await actAs(client, team);

    const { rows: currentRows } = await client.query<Row>(
      `select ${COLUMNS} from "book_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent" for update`,
      [args.lineId, lang],
    );
    const current = currentRows[0];

    const { rows: titled } = await client.query<{ title: string }>(
      `select "title" from "book_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [args.lineId, lang],
    );
    const { rows: placed } = await client.query<{ lineId: string }>(
      `select "lineId" from "book_page" where "lineId" = $1`,
      [args.lineId],
    );
    if (!placed[0]) {
      throw new BookMissing(`${args.lineId} is not a page -- seed the table with: make readables-import`);
    }
    if (
      current &&
      args.expectedVersion !== undefined &&
      args.expectedVersion !== null &&
      args.expectedVersion !== current.version
    ) {
      throw new BookConflict(`this page moved to v${current.version} while you were editing it`);
    }

    const text = args.text.trim();
    if (!text) throw new Error("the text cannot be empty");

    // A save that changes nothing must not spend a version number: the history is a record
    // of what the page has said, not of who opened the dialog.
    if (current && text === current.text) {
      await client.query("commit");
      return toVersion(current);
    }

    const { rows: maxRows } = await client.query<{ version: string }>(
      `select coalesce(max("version"), 0) as "version" from "book_line"
        where "lineId" = $1 and "lang" = $2`,
      [args.lineId, lang],
    );
    const version = Number(maxRows[0].version) + 1;

    await client.query(
      `update "book_line" set "isCurrent" = false
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [args.lineId, lang],
    );

    // The structural fields come from book_page, which places a page once for every language;
    // book_line gets a copy, which the previous release reads.
    //
    // Whether the page can be voiced is not structure: it is a property of this language's
    // text, judged again on every save, with its $N spoken as this language's word
    // (player-words.ts) as the catalogue speaks it.
    const { generatable, skipReason } = isGeneratable(speakPlayerTokens(text, lang));
    const { rows: inserted } = await client.query<Row>(
      `insert into "book_line"
         ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
          "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material",
          "text", "generatable", "skipReason", "editedBy", "note")
       select p."lineId", $2, $3, true, 'edited', p."pageTextId", ${BOOK_ID_COMPAT}, p."pageNumber",
              ${PAGE_COUNT},
              coalesce($9, e."title", ''), p."ownerKind", p."ownerIds", coalesce(p."material", 0),
              $4, $7, $8, $5, $6
         from "book_page" p
         left join "book_line" e on e."lineId" = p."lineId" and e."lang" = '${BASE_LANG}' and e."isCurrent"
        where p."lineId" = $1
       returning ${COLUMNS}`,
      [args.lineId, lang, version, text, args.editedBy, args.note?.trim() || null, generatable, skipReason, titled[0]?.title ?? null],
    );
    await recordActivity(
      {
        kind: "text.edited",
        lang,
        actorId: args.editedBy,
        source: "readables",
        subject: args.lineId,
        lineId: args.lineId,
        detail: { version, text, note: args.note?.trim() || null },
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
 * Puts an earlier version back.
 *
 * Moves the live flag rather than inserting a copy, which is what `restore` means for a
 * lore version and for a take: the history is the set of texts this page has had, and
 * restoring is a statement about which of them is right, not a new one.
 *
 * `by` is who asked, for the activity log: moving the flag writes nothing that names them.
 */
export async function restoreBookText(
  lineId: string,
  version: number,
  lang: Lang,
  by: string | null,
): Promise<BookVersion> {
  // Its activity row is the one write a team owns.
  const team = await loggerOf(lang);
  const client = await db().connect();
  try {
    await client.query("begin");
    await actAs(client, team);

    const { rows } = await client.query<Row>(
      `select ${COLUMNS} from "book_line"
        where "lineId" = $1 and "lang" = $2 and "version" = $3 for update`,
      [lineId, lang, version],
    );
    if (!rows[0]) throw new BookMissing(`${lineId} has no version ${version}`);

    const { rows: was } = await client.query<{ version: number }>(
      `update "book_line" set "isCurrent" = false
        where "lineId" = $1 and "lang" = $2 and "isCurrent"
        returning "version"`,
      [lineId, lang],
    );
    await client.query(
      `update "book_line" set "isCurrent" = true
        where "lineId" = $1 and "lang" = $2 and "version" = $3`,
      [lineId, lang, version],
    );
    await recordActivity(
      {
        kind: "text.restored",
        lang,
        actorId: by,
        source: "readables",
        subject: lineId,
        lineId,
        detail: { version, from: was[0]?.version ?? null },
      },
      client,
    );

    await client.query("commit");
    return toVersion({ ...rows[0], isCurrent: true });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

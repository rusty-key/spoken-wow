// corpus/extract.json -> book_line.
//
// Rerunnable by construction: every line goes through decideImport, so a second run over
// the same extract writes nothing at all. That is what makes it safe to run after every
// dump refresh, which is the only way the corpus keeps tracking vmangos.

import { readFile } from "node:fs/promises";

import pg from "pg";

import { loadEnv } from "../../lib/env.mjs";
import { foldMinted } from "./lib/absorb.mjs";
import { bookPageUpsert } from "./lib/page.mjs";
import { decideImport, structuralDiff } from "./lib/promote.mjs";

// The repo-root .env holds the shared credentials, this pipeline's .env whatever is its
// own; neither is read unless a command like this one asks for it, because lib/ is
// compiled into the site and its paths would be the build machine's.
await loadEnv("readables");

const IN = new URL("../corpus/extract.json", import.meta.url).pathname;
const LANG = "enUS";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set -- the readables corpus lives in Postgres");

const { entries } = JSON.parse(await readFile(IN, "utf8"));
const pool = new pg.Pool({ connectionString: url });

const counts = { promote: 0, record: 0, skip: 0, restructured: 0 };

// Every book_page upsert shares one transaction: book_page_place is deferred, so pages of a
// book that swap numbers in one re-extract are checked at commit, not halfway.
const placing = await pool.connect();

try {
  await placing.query("begin");
  for (const entry of entries) {
    // Where the page sits, whatever its text does: the extract owns structure.
    const placed = bookPageUpsert(entry);
    await placing.query(placed.text, placed.values);

    const { rows } = await pool.query(
      `select "id", "version", "origin", "text", "bookId", "pageNumber", "pageCount",
              "title", "ownerKind", "ownerIds", "material", "generatable", "skipReason"
         from "book_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [entry.lineId, LANG],
    );
    const current = rows[0] ?? null;
    const { action } = decideImport(current, entry);
    counts[action]++;

    // Structure is corrected on the live row whatever the text did, for the reason
    // structuralDiff gives: where a page sits is the extract's business, not an edit's.
    if (current) {
      const moved = structuralDiff(current, entry);
      const fields = Object.keys(moved);
      if (fields.length > 0) {
        counts.restructured++;
        await pool.query(
          `update "book_line" set ${fields.map((f, i) => `"${f}" = $${i + 2}`).join(", ")}
            where "id" = $1`,
          [current.id, ...fields.map((field) => moved[field])],
        );
      }
    }

    if (action === "skip") continue;

    // One transaction per line rather than one for the run: an import of a thousand rows
    // that fails halfway should leave behind the lines it managed, not roll back the lot.
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows: versions } = await client.query(
        `select coalesce(max("version"), 0) as "max" from "book_line"
          where "lineId" = $1 and "lang" = $2`,
        [entry.lineId, LANG],
      );
      const version = Number(versions[0].max) + 1;

      if (action === "promote") {
        await client.query(
          `update "book_line" set "isCurrent" = false
            where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
          [entry.lineId, LANG],
        );
      }

      await client.query(
        `insert into "book_line"
           ("lineId", "lang", "version", "isCurrent", "origin",
            "pageId", "bookId", "pageNumber", "pageCount",
            "title", "ownerKind", "ownerIds", "material",
            "text", "generatable", "skipReason")
         values ($1, $2, $3, $4, 'extracted',
                 $5, $6, $7, $8,
                 $9, $10, $11, $12,
                 $13, $14, $15)`,
        [
          entry.lineId, LANG, version, action === "promote",
          entry.pageId, entry.bookId, entry.pageNumber, entry.pageCount,
          entry.title, entry.ownerKind, entry.ownerIds, entry.material,
          entry.text, entry.generatable, entry.skipReason,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  // A minted page whose words turn out to be a real page's folds into it, in the same
  // transaction as the placing.
  const folded = await foldMinted(placing);

  await placing.query("commit");
  console.log(`${folded} minted pages found in the world database`);

  console.log(
    `${counts.promote} promoted, ${counts.record} recorded, ${counts.skip} unchanged, ` +
      `${counts.restructured} restructured`,
  );
} catch (error) {
  await placing.query("rollback");
  throw error;
} finally {
  placing.release();
  await pool.end();
}

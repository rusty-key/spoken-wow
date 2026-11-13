// vmangos locales_page_text and the owners' localised names -> book_line and entity_name,
// for one language.
//
//   node tools/import-locale.mjs --lang deDE
//
// Straight into Postgres, with no file between: English goes through corpus/extract.json
// because the committed Lua is exported from it, and nothing is built from a translation
// yet. The rules are import.mjs's -- unchanged text is skipped, changed text is promoted
// unless somebody edited the page here, in which case the dump's text is recorded but not
// made live -- and a page is written only where the English corpus has one.

import mysql from "mysql2/promise";
import pg from "pg";

import { loadEnv, MYSQL_VARS } from "../../lib/env.mjs";
import { localeInfo, BASE_LOCALE } from "../../lib/locales.mjs";
import { localizedPages, localizedTitles } from "./lib/locale.mjs";
import { chunks, progress, writeNames } from "../../lib/bulk.mjs";
import { decideImport } from "./lib/promote.mjs";
import { foldMinted } from "./lib/absorb.mjs";
import { BOOK_ID_COMPAT, PAGE_COUNT } from "./lib/page.mjs";

await loadEnv("readables", { override: MYSQL_VARS });

const lang = process.argv[process.argv.indexOf("--lang") + 1];
const info = process.argv.includes("--lang") ? localeInfo(lang) : null;
if (!info || lang === BASE_LOCALE) {
  throw new Error("usage: import-locale.mjs --lang <code>, a language other than English");
}
if (info.vmangos === null) {
  throw new Error(`${lang} has no columns in the world database; its pages are written on the site`);
}
const N = info.vmangos;

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set -- the readables corpus lives in Postgres");
const pool = new pg.Pool({ connectionString: url });

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "wow",
  database: process.env.MYSQL_DATABASE ?? "mangos",
});

const counts = { promote: 0, record: 0, skip: 0, names: 0, folded: 0 };

/** One transaction for a batch of writes: an import that fails leaves nothing half-applied. */
async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await work(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

try {
  // The pages the world database names, placed by book_page: never read from book_line.
  const { rows: extracted } = await pool.query(
    `select "lineId", "ownerKind", coalesce("ownerIds", '{}') as "ownerIds"
       from "book_page" where "pageTextId" is not null and "aliasOf" is null`,
  );
  if (extracted.length === 0) throw new Error("book_page holds no extracted pages; run make readables-import first");
  const structure = new Map(extracted.map((row) => [row.lineId, row]));

  const [pageRows] = await connection.query(
    `SELECT entry, Text_loc${N} AS text FROM locales_page_text`,
  );
  const { pages, withoutEnglish } = localizedPages(pageRows, new Set(structure.keys()));

  // What is live, read once and decided in memory, then written in one transaction: a
  // re-run that changes nothing is one query, not one per page.
  const { rows: livePages } = await pool.query(
    `select "lineId", "origin", "text" from "book_line" where "lang" = $1 and "isCurrent"`,
    [lang],
  );
  const current = new Map(livePages.map((row) => [row.lineId, row]));
  const writes = [];
  for (const page of pages) {
    const { action } = decideImport(current.get(page.lineId) ?? null, page);
    counts[action]++;
    if (action !== "skip") writes.push({ page, promote: action === "promote" });
  }

  await inTransaction(async (client) => {
    const bar = progress("pages", writes.length);
    for (const batch of chunks(writes)) {
      const retiring = batch.filter((write) => write.promote).map((write) => write.page.lineId);
      if (retiring.length > 0) {
        await client.query(
          `update "book_line" set "isCurrent" = false
            where "lineId" = any($1::text[]) and "lang" = $2 and "isCurrent"`,
          [retiring, lang],
        );
      }
      // Structure is book_page's, joined in: where a page sits is a fact about the world, not
      // a translation. The title column carries the English; the language's own title for the
      // owner lives in entity_name.
      await client.query(
        `insert into "book_line"
           ("lineId", "lang", "version", "isCurrent", "origin", "pageId", "bookId",
            "pageNumber", "pageCount", "title", "ownerKind", "ownerIds", "material",
            "text", "generatable", "skipReason")
         select r."lineId", $1,
                coalesce((select max(m."version") from "book_line" m
                           where m."lineId" = r."lineId" and m."lang" = $1), 0) + 1,
                r."promote", 'extracted', p."pageTextId", ${BOOK_ID_COMPAT}, p."pageNumber", ${PAGE_COUNT},
                coalesce((select e."title" from "book_line" e
                           where e."lineId" = p."lineId" and e."lang" = $7 and e."isCurrent"), ''),
                p."ownerKind", p."ownerIds", coalesce(p."material", 0),
                r."text", r."generatable", r."skipReason"
           from unnest($2::text[], $3::boolean[], $4::text[], $5::boolean[], $6::text[])
                as r("lineId", "promote", "text", "generatable", "skipReason")
           join "book_page" p on p."lineId" = r."lineId" and p."aliasOf" is null`,
        [
          lang,
          batch.map((w) => w.page.lineId),
          batch.map((w) => w.promote),
          batch.map((w) => w.page.text),
          batch.map((w) => w.page.generatable),
          batch.map((w) => w.page.skipReason),
          BASE_LOCALE,
        ],
      );
      bar.add(batch.length);
    }
    bar.end();
    // This language's words may show a minted page to be a real one.
    counts.folded = await foldMinted(client);
  });

  // The owners the extracted pages have, and nothing else: the dump localises every item.
  const owners = { object: new Set(), item: new Set() };
  for (const row of extracted) if (row.ownerKind) for (const id of row.ownerIds) owners[row.ownerKind].add(id);
  const ownerRows = [];
  for (const [kind, table] of [["object", "locales_gameobject"], ["item", "locales_item"]]) {
    if (owners[kind].size === 0) continue;
    const [rows] = await connection.query(
      `SELECT entry AS id, name_loc${N} AS name FROM ${table} WHERE entry IN (?)`,
      [[...owners[kind]]],
    );
    ownerRows.push(...rows.map((row) => ({ kind, ...row })));
  }

  const { rows: liveNames } = await pool.query(
    `select "kind", "entityId", "origin", "name" as "text" from "entity_name"
      where "lang" = $1 and "kind" in ('item', 'gameobject') and "isCurrent"`,
    [lang],
  );
  const currentNames = new Map(liveNames.map((row) => [`${row.kind}:${row.entityId}`, row]));
  const nameWrites = [];
  for (const title of localizedTitles(ownerRows)) {
    const { action } = decideImport(currentNames.get(`${title.kind}:${title.entityId}`) ?? null, {
      text: title.name,
    });
    if (action !== "skip") nameWrites.push({ ...title, promote: action === "promote" });
  }
  counts.names = nameWrites.length;

  await inTransaction((client) => writeNames(client, lang, nameWrites, "titles"));

  console.log(
    `${lang}: ${counts.promote} pages promoted, ${counts.record} recorded, ${counts.skip} unchanged, ` +
      `${withoutEnglish} without an English page; ${counts.names} titles written; ` +
      `${counts.folded} minted pages found in the world database`,
  );
} finally {
  await connection.end();
  await pool.end();
}

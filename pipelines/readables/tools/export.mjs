// book_line -> addons/Spoken_Readables/Data/Books.lua.
//
// The table is the corpus and this file is an export of it, exactly as the places side
// exports lore_line: the addon build, and anyone packaging a release, must work on a clone
// with no Postgres, so what the addon ships is committed rather than derived at build time.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import pg from "pg";

import { loadEnv } from "../../lib/env.mjs";
import { booksLua, luaTableId } from "./lib/lua.mjs";

// The repo-root .env holds the shared credentials, this pipeline's .env whatever is its
// own; neither is read unless a command like this one asks for it, because lib/ is
// compiled into the site and its paths would be the build machine's.
await loadEnv("readables");

const OUT = new URL("../../../addons/Spoken_Readables/Data/Books.lua", import.meta.url).pathname;
const LANG = "enUS";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set -- the readables corpus lives in Postgres");

const pool = new pg.Pool({ connectionString: url });

try {
  const { rows } = await pool.query(
    `select case when p."pageTextId" is not null then p."pageTextId"::text
                   else substr(p."lineId", 3) end as "pageId",
            p."pageTextId" is not null as "numeric", p."bookId" as "bookId", p."pageNumber",
            count(*) over (partition by p."bookId")::int as "pageCount", l."title", l."text",
            coalesce((select n."name" from "entity_name" n
                       where n."kind" = case p."ownerKind" when 'object' then 'gameobject' else 'item' end
                         and n."entityId" = p."ownerIds"[1]::text and n."lang" = $1 and n."isCurrent"
                       limit 1), l."title") as "bookTitle",
            p."ownerKind", p."ownerIds"
       from "book_page" p
       join "book_line" l on l."lineId" = p."lineId" and l."lang" = $1 and l."isCurrent"
      where p."aliasOf" is null
      order by p."bookId", p."pageNumber"`,
    [LANG],
  );

  // Refused rather than written empty: an export of nothing would replace a good committed
  // file with a table the addon can look nothing up in, and the addon would fail silently.
  if (rows.length === 0) {
    throw new Error(
      "book_line holds no English pages -- run: make readables-extract && make readables-import",
    );
  }

  for (const row of rows) {
    if (row.numeric) row.pageId = Number(row.pageId);
    row.bookId = luaTableId(row.bookId);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, booksLua(rows));

  const books = new Set(rows.map((row) => row.bookId));
  console.log(`${rows.length} pages, ${books.size} books -> ${OUT}`);
} finally {
  await pool.end();
}

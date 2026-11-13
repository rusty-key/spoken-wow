// vmangos -> corpus/extract.json.
//
// Writes a file rather than importing straight into Postgres, for the reason the quests
// pipeline splits the same way: the dump is only reachable from a machine running the
// Docker MySQL, the import is not, and a reviewable intermediate makes "did the extract
// change" answerable with a diff instead of a database query.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import mysql from "mysql2/promise";

import { loadEnv, MYSQL_VARS } from "../../lib/env.mjs";
import { FOREVER_BUILD, wagoTable } from "../../lib/wago.mjs";
import { FOREVER_ITEMS, readForever, readWorld, withForever, PATCH } from "./lib/world.mjs";
import { buildBooks } from "./lib/chains.mjs";

const OUT = new URL("../corpus/extract.json", import.meta.url).pathname;

// MYSQL_*, the same names the quests pipeline reads, out of the same repo-root .env. It is
// one vmangos dump and one set of credentials; two spellings of them was a way for the two
// extracts to disagree about which database they were reading.
//
// These names used to be BOOKS_-prefixed, and the reason is still live: generic names like
// MYSQL_PASSWORD are exported by other projects, and an ambient one turns "connect to the
// local vmangos" into an access-denied error that looks like the dump is missing. One such
// variable was already exported on the machine this was written on. What makes the prefix
// unnecessary is loadEnv: this file now reads .env rather than relying on whatever the
// shell happens to export, exactly as tts_cli/env_vars.py has with override=True.
//
// THE LOAD HAS TO COME FIRST. The defaults below are the quests pipeline's docker-compose
// values, and they are what an unread .env silently falls back to.
await loadEnv("readables", { override: MYSQL_VARS });

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "wow",
  database: process.env.MYSQL_DATABASE ?? "mangos",
});

try {
  const vanilla = await readWorld(connection, Number(process.env.BOOKS_PATCH ?? PATCH));
  const forever = await readForeverRepack();
  const world = forever ? withForever(vanilla, forever) : vanilla;
  const { entries, orphans, shared } = buildBooks(world);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({ entries, orphans, shared }, null, 2)}\n`);

  const books = new Set(entries.map((entry) => entry.bookId));
  const silent = entries.filter((entry) => !entry.generatable);
  console.log(
    `${entries.length} pages, ${books.size} books, ${orphans.length} orphaned pages, ` +
      `${shared.length} pages claimed by a second chain`,
  );
  console.log(`${silent.length} pages cannot be voiced: ${summarise(silent)}`);
  console.log(`wrote ${OUT}`);
} finally {
  await connection.end();
}

// Forever's own readables, from the Forever repack that places.mjs reads, with its
// PLACES_MYSQL_* variables. Where it is not running they are left out of this extract, which
// removes nothing from the corpus: the import only adds and updates.
async function readForeverRepack() {
  let repack;
  try {
    repack = await mysql.createConnection({
      host: process.env.PLACES_MYSQL_HOST ?? "127.0.0.1",
      port: Number(process.env.PLACES_MYSQL_PORT ?? 3317),
      user: process.env.PLACES_MYSQL_USER ?? "root",
      password: process.env.PLACES_MYSQL_PASSWORD ?? "",
      database: process.env.PLACES_MYSQL_DATABASE ?? "world",
    });
  } catch (error) {
    console.warn(`no Forever repack (${error.code ?? error.message}): Forever's own readables are left out`);
    return null;
  }
  try {
    const items = (await wagoTable("ItemSparse", { build: FOREVER_BUILD }))
      .filter((row) => FOREVER_ITEMS.includes(Number(row.ID)) && Number(row.PageID) > 0)
      .map((row) => ({
        kind: "item",
        id: Number(row.ID),
        name: row.Display_lang,
        firstPage: Number(row.PageID),
        material: Number(row.PageMaterialID),
      }));
    const pageless = FOREVER_ITEMS.filter((id) => !items.some((item) => item.id === id));
    if (pageless.length) throw new Error(`Forever's client gives no page to items ${pageless.join(", ")}`);

    const forever = await readForever(repack, items);
    const reached = new Set(forever.pages.map((page) => page.entry));
    const empty = forever.owners.filter((owner) => !reached.has(owner.firstPage));
    console.log(
      `${forever.pages.length} Forever pages` +
        (empty.length ? `; no text yet for ${empty.map((o) => `${o.name} (${o.id})`).join(", ")}` : ""),
    );
    return forever;
  } finally {
    await repack.end();
  }
}

function summarise(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.skipReason, (counts.get(entry.skipReason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => `${count} ${reason}`).join(", ") || "none";
}

#!/usr/bin/env node
// One language's zone and subzone names -> entity_name.
//
//   node tools/lore/import-names.mjs --lang deDE
//
// From tools/seed/area-names.json, which `make places-aliases` builds from the game's
// UiMap and AreaTable: the names a client in that language actually shows, zones included.
// The lore prose has no such source -- nothing in the dump or the client carries it
// translated -- so it is written on the site, and this only names the places.
//
// The rule is every import's: an unchanged name is skipped, a changed one replaces an
// extracted name but never one somebody edited here.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { BASE_LOCALE, isClientLocale, isLocale } from "../../../lib/locales.mjs";
import { loadEnvFile } from "../lib/env.mjs";
import { decideImport } from "../../../lib/promote.mjs";
import { namesForLines } from "../lib/area-names.mjs";
import { ROOT } from "../lib/loredata.mjs";
import { writeNames } from "../../../lib/bulk.mjs";

await loadEnvFile();
const { close, isEnabled, query, transaction } = await import("../voice/db.mjs");

const lang = process.argv[process.argv.indexOf("--lang") + 1];
if (!process.argv.includes("--lang") || !isLocale(lang) || lang === BASE_LOCALE) {
  console.error("usage: import-names.mjs --lang <code>, a language other than English");
  process.exit(2);
}
// The names come from what a client shows, and no client runs in this language: its place
// names are written on the site.
if (!isClientLocale(lang)) {
  console.log(`${lang}: no client runs in it, so there are no game place names to import`);
  process.exit(0);
}
if (!isEnabled()) {
  console.error("error: DATABASE_URL is not set, so there is nothing to import into.");
  process.exit(1);
}

const counts = { promote: 0, record: 0, skip: 0 };

try {
  const seed = JSON.parse(
    await readFile(join(ROOT, "pipelines/places/tools/seed/area-names.json"), "utf8"),
  );
  const names = seed.names[lang];
  if (!names) throw new Error(`area-names.json has no ${lang}; run make places-aliases`);
  const { rows: lines } = await query(
    `select "lineId", "kind", "mapID", "key" from "lore_line"
      where "lang" = $1 and "isCurrent"`,
    [BASE_LOCALE],
  );
  if (lines.length === 0) throw new Error("lore_line holds no English lines; run make places-lore-import");

  // What is live, read once and decided in memory: a re-run that changes nothing is one
  // query, not three per place.
  const { rows: live } = await query(
    `select "kind", "entityId", "origin", "name" as "text" from "entity_name"
      where "lang" = $1 and "kind" in ('zone', 'subzone') and "isCurrent"`,
    [lang],
  );
  const current = new Map(live.map((row) => [`${row.kind}:${row.entityId}`, row]));

  const writes = [];
  for (const name of namesForLines(lines, names)) {
    const { action } = decideImport(current.get(`${name.kind}:${name.entityId}`) ?? null, {
      text: name.name,
    });
    counts[action]++;
    if (action !== "skip") writes.push({ ...name, promote: action === "promote" });
  }

  await transaction((client) => writeNames(client, lang, writes, "place names"));

  console.log(
    `${lang}: ${counts.promote} names written, ${counts.record} recorded under an edit, ` +
      `${counts.skip} unchanged`,
  );
} finally {
  await close();
}

#!/usr/bin/env node
// Writes addons/Spoken_Places/Data/<lang>/{Zones,Subzones}.lua from lore_line, English and
// every language with a translation.
//
//   node tools/lore/export.mjs           # write every language's pair
//   node tools/lore/export.mjs --check   # fail if the files are out of date, write nothing
//
// The counterpart to tools/voice/export-manifest.mjs, and there for the same reason: the
// database is where the corpus is authored, and a file is what the addon ships. Between
// the two sits a commit, deliberately -- a text change reaching players should be as
// visible in `git diff` as any other change to what the addon contains.
//
// --check is the CI-shaped question: does the committed Lua still match the database?
// It is not part of `make check`, which has to keep passing on clones with no Postgres.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { zonesLua, subzonesLua } from "../lib/loredata.mjs";
import { loadClientAreas, loadClientNames } from "../lib/era.mjs";
import { BASE_LOCALE, CODES } from "../lib/locales.mjs";
import { readJson, ROOT } from "../lib/wiki.mjs";
import { emitZones, emitSubzones } from "./lua.mjs";
import { isEnabled, readCurrent, readNames, writeCorpus } from "./store.mjs";
import { close } from "../voice/db.mjs";
import { loadEnvFile } from "../lib/env.mjs";

// Before anything reads DATABASE_URL.
await loadEnvFile();

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");

async function main() {
  if (!isEnabled()) {
    console.error("error: DATABASE_URL is not set, so there is no corpus to export.");
    console.error("       the committed Lua files are already the record; nothing to do.");
    process.exit(1);
  }

  const allRows = await readCurrent(BASE_LOCALE);
  if (allRows.length === 0) {
    console.error("error: lore_line has no rows. Seed it with:  make zones-lore-import");
    process.exit(1);
  }

  // The database keeps every line ever scraped, including places the wiki's
  // categories offered that no client can report (Cataclysm and later). Those rows stay
  // as history; the addon only ships what a client can ask for -- either client, since
  // it ships for both, which is why this is the union and not the Era seed alone.
  const client = await loadClientAreas();
  const rows = allRows.filter((row) => row.kind !== "subzone" || client.keys.has(row.key));
  const unreachable = allRows.length - rows.length;
  if (unreachable) {
    console.log(
      `leaving ${unreachable} line(s) behind: no client can report them ` +
        `(builds ${client.builds.join(", ")})`,
    );
  }
  // Forever's spelling of a place the lore keeps under another key is that place, not a second
  // one: Data/ForeverAreas.lua sends the client's name to the frozen key.
  const { renamed } = await readJson(join(ROOT, "pipelines/zones/tools/seed/forever-places.json"));
  const twice = rows.filter((row) => row.kind === "subzone" && renamed[row.key]);
  for (const row of twice) rows.splice(rows.indexOf(row), 1);
  if (twice.length) {
    console.log(`leaving ${twice.length} line(s) behind: Forever's spelling of a place kept under another key`);
  }

  // An area is titled as the client names it (The Crossroads), not as the wiki titles its page.
  const clientName = await loadClientNames();
  const areaName = (row) => (row.kind === "subzone" && clientName.get(row.key)) || row.name;
  for (const row of rows) row.name = areaName(row);

  // A 'discovered' row is a place the client has and nobody has written about yet. It
  // ships anyway, with empty text and a `pending` marker, because a place the player can
  // stand in and see named on the map is worth listing even before anyone has described
  // it: the addon says "not written yet" where it would otherwise say nothing at all, and
  // the subzone shows up in the zone's list rather than being invisible.
  //
  // The marker is what keeps that honest. validate.mjs fails on an entry with empty text,
  // correctly, because for every other origin an empty line is a broken one -- so pending
  // is the exemption it checks for, not a special case for the word "discovered".
  const unwritten = rows.filter((row) => !row.full.trim() || !row.short.trim()).length;
  if (unwritten) {
    console.log(`${unwritten} line(s) ship as pending: discovered, not written yet`);
  }

  // A translation ships only for a line English ships with text. English is the key set
  // every language is looked up by, so a line outside it is unreachable, and validate.mjs
  // refuses it ("translated from what?"). A translated line with no text is left out rather
  // than shipped pending: the addon has no per-line fallback, so the place goes unlisted in
  // that language, and Languages.lua keeps the language off the switcher until it is whole.
  const written = new Set(rows.filter((row) => row.full.trim()).map((row) => row.lineId));

  const corpora = [{ lang: BASE_LOCALE, rows }];
  for (const lang of CODES) {
    if (lang === BASE_LOCALE) continue;
    // The place is named as that language's client names it, the way the site does; the
    // row's own name is the English one it was seeded with. English stays where no name is
    // known, which beats a heading with nothing in it.
    const names = await readNames(lang);
    const translated = (await readCurrent(lang))
      .filter((row) => written.has(row.lineId) && row.full.trim() && row.short.trim())
      .map((row) => ({ ...row, name: names.get(row.lineId) || areaName(row) }));
    // A language ships as a pair of files or not at all: one with no zones or no areas
    // written yet would leave a file with nothing in it, which writeCorpus refuses.
    const kinds = new Set(translated.map((row) => row.kind));
    if (kinds.has("zone") && kinds.has("subzone")) {
      corpora.push({ lang, rows: translated });
    } else if (translated.length) {
      console.log(`skipping ${lang}: ${translated.length} line(s), but no ${kinds.has("zone") ? "areas" : "zones"} yet`);
    }
  }

  const stale = [];
  for (const { lang, rows: langRows } of corpora) {
    const edited = langRows.filter((row) => row.origin === "edited").length;
    const summary = `${lang}: ${langRows.length} lines, ${edited} hand-edited`;

    if (checkOnly) {
      const zones = langRows.filter((r) => r.kind === "zone");
      const subzones = langRows.filter((r) => r.kind === "subzone");
      const zoneNames = new Map(zones.map((z) => [z.mapID, z.name]));

      let upToDate = true;
      for (const [path, wanted] of [
        [zonesLua(lang), emitZones(zones, lang)],
        [subzonesLua(lang), emitSubzones(subzones, zoneNames, lang)],
      ]) {
        const onDisk = await readFile(path, "utf8").catch(() => null);
        if (onDisk !== wanted) {
          stale.push(path);
          upToDate = false;
        }
      }
      if (upToDate) console.log(`up to date -- ${summary}`);
      continue;
    }

    const counts = await writeCorpus(langRows, lang);
    console.log(
      `${lang}: wrote ${counts.zones} zones and ${counts.subzones} subzones ` +
        `(${edited} hand-edited)`,
    );
  }

  if (checkOnly) {
    if (stale.length) {
      console.error("out of date with the database:");
      for (const path of stale) console.error(`  ! ${path}`);
      console.error("\nregenerate with:  make lore-export");
      process.exitCode = 1;
    }
    return;
  }

  console.log("\nreview with:  git diff addons/Spoken_Places/Data/");
  console.log("a new language also needs its two files in Spoken_Places.toc, then:  make zones-languages");
  console.log("then rebuild the audio lookup if any English text moved:  make zones-lookup");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(close);

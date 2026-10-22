#!/usr/bin/env node
// Writes addons/Spoken_Places/Data/<locale>/Aliases.lua for every non-English locale.
//
//   node tools/locale/build-aliases.mjs               # the pinned builds (pipelines/lib/wago.mjs)
//   node tools/locale/build-aliases.mjs --build 1.15.9.69109   # another Era build
//
// Forever's table first, then Era's: a Forever client names some places differently from
// Era's (its own translations, its renames), and a name only Era's has still serves an Era
// client. Forever's spelling of a place the lore keeps under another key goes to that key
// (seed/forever-places.json: Lager der Legashi is legash encampment). A name the client gives
// several places goes into a second table, by the zone each place's story is kept under
// (zoneAliasesOf in lib/aliases.mjs).
//
// The corpus is keyed by English area name in every language, because a place is
// one place whatever it is called. The client, however, hands the addon the name
// in its own language: a German client reports "Sengende Schlucht", which
// matches nothing, which is why non-English players saw no subzone lore at all
// before these tables existed. AreaTable carries both names against one ID, so
// the mapping is a join, not a translation, and costs nothing to produce.
//
// Keyed by the RAW client name rather than a normalised one. SpokenZones's
// normalisation reduces a name to [a-z0-9 ] to reconcile the wiki's punctuation
// with the client's, and that is exactly wrong here: "Дун Морог" normalises to
// nothing at all. AreaTable is the table the client reads its names out of, so
// an exact string match is both available and the most precise thing on offer.
//
// Some locales have no Era translation and their table comes out empty. That is
// a real answer -- Italian Classic runs on English area names -- not a failure.
//
// It also writes tools/seed/area-names.json: every corpus zone and subzone's name in
// each language, same-as-English ones included, zones from UiMap and subzones from
// AreaTable. That is what the site names places with (tools/lore/import-names.mjs); the
// alias tables cannot serve for it, see lib/area-names.mjs. The Era build names what it
// has, and the Camelot build (seed/camelot-areas.json) fills in the places only it has
// -- Mount Hyjal, the Darkspear Islands -- which Era's tables have no row for.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { aliasesOf, emitAliases, zoneAliasesOf } from "../lib/aliases.mjs";
import { areaNames, mapNames } from "../lib/area-names.mjs";
import { ERA_BUILD, FOREVER_BUILD, wagoTable as fetchTable } from "../../../lib/wago.mjs";
import { BASE_LOCALE, isClientLocale, LOCALES } from "../lib/locales.mjs";
import { readSubzones, readZones } from "../lib/loredata.mjs";
import { normaliseKey, readJson, ROOT } from "../lib/wiki.mjs";

const SEED = join(ROOT, "pipelines/zones/tools/seed/area-names.json");
const PLACES = join(ROOT, "pipelines/zones/tools/seed/forever-places.json");

const argv = process.argv.slice(2);
const build = argv.includes("--build") ? argv[argv.indexOf("--build") + 1] : ERA_BUILD;

async function main() {
  // Only names the corpus actually has lore for. AreaTable is four times the
  // size of the corpus, and an alias to a key nothing is stored under is weight
  // in every player's memory for no lookup that can ever succeed.
  const subzones = await readSubzones();
  const wanted = new Set(subzones.map((s) => s.key));
  const mapsOf = new Map();
  for (const { key, mapID } of subzones) mapsOf.set(key, [...(mapsOf.get(key) || []), mapID]);

  console.log(`fetching AreaTable for ${build}`);
  const english = await fetchTable("AreaTable", { build });
  const mapIDs = new Set((await readZones()).map((z) => z.mapID));
  const camelot = (await readJson(join(ROOT, "pipelines/zones/tools/seed/camelot-areas.json"))).build;
  console.log(`fetching AreaTable for ${camelot}`);
  const camelotEnglish = await fetchTable("AreaTable", { build: camelot });
  console.log(`fetching AreaTable for ${FOREVER_BUILD}`);
  const foreverEnglish = await fetchTable("AreaTable", { build: FOREVER_BUILD });
  const { renamed } = await readJson(PLACES);
  const eraKey = (name) => normaliseKey(name);
  const foreverKey = (name) => renamed[normaliseKey(name)]?.key ?? normaliseKey(name);
  const seed = {};

  for (const locale of LOCALES) {
    if (locale.code === BASE_LOCALE) continue;
    // No client runs in it, so no client shows its names and nothing needs an alias. Asked
    // anyway, wago.tools answers a locale the game never shipped in English, which would
    // seed English names as that language's own.
    if (!isClientLocale(locale.code)) continue;

    const rows = await fetchTable("AreaTable", { build, locale: locale.code });
    const maps = await fetchTable("UiMap", { build, locale: locale.code });
    const [camelotRows, camelotMaps] = await Promise.all([
      fetchTable("AreaTable", { build: camelot, locale: locale.code }),
      fetchTable("UiMap", { build: camelot, locale: locale.code }),
    ]);
    // Era first, so a name both builds carry is Era's; Camelot only adds.
    const zones = new Map([...mapNames(camelotMaps, mapIDs), ...mapNames(maps, mapIDs)]);
    const areas = new Map([
      ...areaNames(camelotEnglish, camelotRows, wanted),
      ...areaNames(english, rows, wanted),
    ]);
    seed[locale.code] = {
      zones: Object.fromEntries([...zones].sort(([a], [b]) => a - b)),
      subzones: Object.fromEntries([...areas].sort(([a], [b]) => (a < b ? -1 : 1))),
    };

    // Forever's names first; Era's add the names Forever's lack, never one Forever's left out
    // as ambiguous.
    const foreverRows = await fetchTable("AreaTable", { build: FOREVER_BUILD, locale: locale.code });
    const fromForever = aliasesOf(foreverEnglish, foreverRows, wanted, foreverKey);
    const fromEra = aliasesOf(english, rows, wanted, eraKey);
    const aliases = new Map(fromForever.aliases);
    const ambiguous = new Set(fromForever.ambiguous);
    for (const [name, key] of fromEra.aliases) {
      if (!aliases.has(name) && !ambiguous.has(name)) aliases.set(name, key);
    }
    for (const name of fromEra.ambiguous) if (!aliases.has(name)) ambiguous.add(name);
    const byZone = zoneAliasesOf(
      [
        { english: foreverEnglish, localized: foreverRows, keyOf: foreverKey },
        { english, localized: rows, keyOf: eraKey },
      ],
      mapsOf,
    );

    const dir = join(ROOT, "addons/Spoken_Places/Data", locale.code);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "Aliases.lua"),
      emitAliases(locale.code, aliases, [FOREVER_BUILD, build], byZone),
    );

    // Coverage counts corpus keys reached, not alias rows: several client names
    // can share one key, and counting rows reports more than 100% coverage.
    // The keys with no alias are the ones whose name is the same in both
    // languages -- harmless on a Latin client, which normalises its way to them,
    // and unreachable on one whose script normalisation erases.
    const covered = new Set(aliases.values()).size;
    const pct = ((covered / wanted.size) * 100).toFixed(0);
    const note =
      (ambiguous.size ? `, ${ambiguous.size} ambiguous dropped` : "") +
      (byZone.size ? `, ${byZone.size} told apart by zone` : "");
    console.log(
      `${locale.code}: ${covered} of ${wanted.size} subzone keys (${pct}%) via ${aliases.size} names${note}`,
    );
  }

  const out = {
    _comment: [
      "What each corpus zone and subzone is called in each client language, from the",
      "client's own tables via wago.tools: zones from UiMap by uiMapID, subzones from",
      "AreaTable by English key, the Era build first and the Camelot build for places",
      "only it has. Names the same as English are kept: they are that language's",
      "name too. Read by tools/lore/import-names.mjs.",
      "Regenerate with:  make zones-aliases",
    ],
    builds: [build, camelot],
    names: seed,
  };
  await writeFile(SEED, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${SEED}`);

}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

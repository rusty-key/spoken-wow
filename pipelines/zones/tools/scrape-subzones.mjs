#!/usr/bin/env node
// Builds addons/Spoken_Zones/Data/Subzones.lua from warcraft.wiki.gg.
//
//   node tools/scrape-subzones.mjs                # every zone in the seed
//   node tools/scrape-subzones.mjs --zone 1420    # one parent zone
//   node tools/scrape-subzones.mjs --refresh
//   node tools/scrape-subzones.mjs --verbose      # show era-filter drops
//   node tools/scrape-subzones.mjs --list 1420    # just list the category
//
// Subzones are enumerated from "Category:<Zone> subzones", which exists for
// nearly every Classic zone.
//
// Entries are keyed by NORMALISED NAME, not by ID: subzones are areas rather
// than uiMapIDs, and MapUtil.FindBestAreaNameAtMouse hands back a name string.
// See normaliseKey in lib/wiki.mjs for the canonical form.
//
// The wiki's subzone categories mix every era of the game, so candidates are
// checked against tools/seed/era-areas.json -- the Era client's own AreaTable --
// and anything the client cannot report is dropped before it costs a wiki
// fetch, a rewrite call or a voice line. (These rows used to be kept as "inert",
// which was true for the addon and false for the bills.)

import { join } from "node:path";
import {
  ROOT,
  classicVariant,
  fetchCategoryMembers,
  fetchClassicTitleIndex,
  fetchLoreText,
  makeShort,
  normaliseKey,
  readJson,
  sourceUrl,
  stripClassicSuffix,
  withoutComments,
} from "./lib/wiki.mjs";
import { loadEraAreas } from "./lib/era.mjs";
import { persistScrape } from "./lore/store.mjs";
import { close } from "./voice/db.mjs";

const SEED = join(ROOT, "pipelines/zones/tools/seed/subzones.json");

// Subzone leads are naturally shorter than zone leads, so the threshold for
// falling back to the full article's lore sections is lower.
const MIN_INTRO_CHARS = 200;

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const flags = {
  refresh: argv.includes("--refresh"),
  verbose: argv.includes("--verbose"),
  zone: arg("--zone"),
  list: arg("--list"),
};

// Pages in a subzone category that are not places you can stand in on the world
// map: factions, events, NPC groups, building interiors.
const NOT_A_PLACE = [
  /\btribe$/i,
  /\bundead$/i,
  /^Battle for /i,
  /\bNPCs$/i,
  /^Mindless Ones$/i,
  /\bquests$/i,
];

function looksLikeAPlace(title) {
  return !NOT_A_PLACE.some((re) => re.test(title));
}

async function main() {
  const seedRaw = await readJson(SEED);
  const zones = withoutComments(seedRaw.zones || {});
  const aliasesByZone = withoutComments(seedRaw.aliases || {});

  if (flags.list) {
    const meta = zones[flags.list];
    if (!meta) {
      console.error(`no seed entry for zone ${flags.list}`);
      process.exit(1);
    }
    const members = await fetchCategoryMembers(meta.category || `${meta.name} subzones`, {
      refresh: flags.refresh,
    });
    console.log(`${members.length} member(s) of Category:${meta.name} subzones:`);
    for (const m of members) {
      console.log(`  ${looksLikeAPlace(m) ? " " : "x"} ${m}`);
    }
    return;
  }

  const targets = flags.zone
    ? Object.entries(zones).filter(([id]) => id === String(flags.zone))
    : Object.entries(zones);

  if (targets.length === 0) {
    console.error(`no seed entry matched --zone ${flags.zone}`);
    process.exit(1);
  }

  // Prefer purpose-written "(Classic)" articles wherever the wiki has them.
  const classicIndex = await fetchClassicTitleIndex({ refresh: flags.refresh });
  console.log(`${classicIndex.size} Classic-specific page titles available`);

  const era = await loadEraAreas();
  console.log(`${era.keys.size} area names in the Era client (build ${era.build})`);

  const byZone = new Map();
  const stats = new Map();
  const problems = [];
  let fetched = 0;
  let cached = 0;
  let classicUsed = 0;

  for (const [idStr, meta] of targets) {
    const mapID = Number(idStr);
    const category = meta.category || `${meta.name} subzones`;
    const aliases = withoutComments(aliasesByZone[idStr] || {});

    console.log(`\n${meta.name} (${mapID}) -- Category:${category}`);

    let members;
    try {
      members = await fetchCategoryMembers(category, { refresh: flags.refresh });
    } catch (err) {
      problems.push(`${meta.name} (${mapID}): category fetch failed -- ${err.message}`);
      continue;
    }

    const candidates = members.filter(looksLikeAPlace);
    // By key rather than by title, so "Uplands" also drops a page titled "The Uplands".
    const excluded = new Set((meta.exclude || []).map(normaliseKey));
    let skippedFiltered = 0;
    let skippedZoneDup = 0;
    let skippedNotInEra = 0;

    const entries = new Map();

    for (const title of candidates) {
      if (excluded.has(normaliseKey(title))) continue;

      // Key on the bare wiki title. Aliases add extra keys for client names that
      // do not normalise onto it. Any key the Era client cannot report is
      // dropped, and a place with no reportable key at all is skipped before
      // its article is even fetched.
      const keys = new Set([normaliseKey(title)]);
      for (const [clientName, wikiTitle] of Object.entries(aliases)) {
        if (wikiTitle === title) keys.add(normaliseKey(clientName));
      }
      for (const key of keys) {
        if (!era.keys.has(key)) keys.delete(key);
      }
      if (keys.size === 0) {
        skippedNotInEra++;
        if (flags.verbose) console.log(`    not in the Era client: ${title}`);
        continue;
      }

      // Prefer a purpose-written "(Classic)" article where one exists. The key
      // and display name always come from the bare title, so the suffix never
      // reaches the addon.
      const classicTitle = classicVariant(title, classicIndex);
      const fetchTitle = classicTitle || title;

      let lore;
      try {
        lore = await fetchLoreText(fetchTitle, {
          refresh: flags.refresh,
          minChars: MIN_INTRO_CHARS,
          verbose: flags.verbose,
        });
      } catch (err) {
        problems.push(`${fetchTitle}: ${err.message}`);
        continue;
      }
      fetched += lore.fetches;
      cached += lore.cacheHits;

      if (lore.missing) {
        problems.push(`${fetchTitle}: no extract (page may be a stub or missing)`);
        continue;
      }
      if (classicTitle) classicUsed++;

      // A subzone page that redirects to its parent zone would just duplicate
      // the zone lore already shown by the panel.
      if (normaliseKey(stripClassicSuffix(lore.resolvedTitle)) === normaliseKey(meta.name)) {
        skippedZoneDup++;
        continue;
      }

      if (!lore.cleaned.full) {
        skippedFiltered++;
        continue;
      }

      for (const key of keys) {
        entries.set(key, {
          name: stripClassicSuffix(title),
          short: makeShort(lore.cleaned.full),
          full: lore.cleaned.full,
          source: sourceUrl(lore.resolvedTitle),
        });
      }
    }

    byZone.set(mapID, entries);
    stats.set(mapID, { zoneName: meta.name });

    console.log(
      `  ${members.length} in category, ${candidates.length} look like places, ` +
        `${entries.size} kept` +
        (skippedNotInEra ? `, ${skippedNotInEra} not in the Era client` : "") +
        (skippedFiltered ? `, ${skippedFiltered} empty after era filter` : "") +
        (skippedZoneDup ? `, ${skippedZoneDup} redirect to the zone` : "")
    );
  }

  // Flattened out of the per-zone maps, because the store keys on lineId and does not
  // care how the scrape was organised.
  const entries = [];
  for (const [mapID, keyed] of byZone) {
    for (const [key, entry] of keyed) {
      entries.push({ mapID, kind: "subzone", key, ...entry });
    }
  }

  // With a database a --zone run is safe: rows are keyed by lineId, so scraping one
  // zone updates one zone. Against the file it would truncate Subzones.lua to whatever
  // was scraped, which is why that combination writes nothing.
  const zoneNames = new Map([...stats].map(([mapID, s]) => [mapID, s.zoneName]));
  const result = await persistScrape(entries, {
    partial: Boolean(flags.zone),
    zoneNames,
  });

  console.log();
  if (result.target === "database") {
    console.log(
      `recorded ${result.inserted} new version(s): ${result.promoted} promoted, ` +
        `${result.heldBack} held back behind a hand edit, ${result.unchanged} unchanged`,
    );
    if (result.inserted) console.log("write the addon data files with:  make lore-export");
  } else if (result.target === "skipped") {
    console.log("--zone run with no database: not writing Data/Subzones.lua");
    console.log("run without --zone, or set DATABASE_URL, to keep the other zones");
  } else {
    console.log(`wrote Data/Subzones.lua (${byZone.size} zones, ${result.count} subzone keys)`);
  }

  console.log(
    `fetched ${fetched}, from cache ${cached}, ${classicUsed} from a (Classic) page`
  );
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ! ${p}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  // An open pool keeps the process alive after main() returns, which looks like a hang.
  .finally(close);

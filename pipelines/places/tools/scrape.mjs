#!/usr/bin/env node
// Builds addons/Spoken_Places/Data/Zones.lua from warcraft.wiki.gg page intros.
//
//   node tools/scrape.mjs                 # use cache where present
//   node tools/scrape.mjs --refresh       # re-fetch everything
//   node tools/scrape.mjs --only 1411     # single zone, useful when tuning
//   node tools/scrape.mjs --no-era-filter # keep post-vanilla sentences
//   node tools/scrape.mjs --no-classic    # ignore "(Classic)" pages
//   node tools/scrape.mjs --verbose       # show what the era filter dropped
//
// Requires Node 18+ (built-in fetch). No dependencies.
//
// Lore text is CC BY-SA 4.0 from warcraft.wiki.gg contributors.

import { join } from "node:path";
import {
  ROOT,
  classicVariant,
  fetchClassicTitleIndex,
  fetchLoreText,
  makeShort,
  readJson,
  readJsonIfExists,
  sourceUrl,
  withoutComments,
} from "./lib/wiki.mjs";
import { persistScrape } from "./lore/store.mjs";
import { close } from "./voice/db.mjs";

const SEED = join(ROOT, "pipelines/places/tools/seed/zones.json");
const OVERRIDES = join(ROOT, "pipelines/places/tools/seed/overrides.json");

// Below this, a page's lead is too thin to show and the full-article section
// fallback is tried instead.
const MIN_INTRO_CHARS = 300;

const argv = process.argv.slice(2);
const flags = {
  refresh: argv.includes("--refresh"),
  eraFilter: !argv.includes("--no-era-filter"),
  noClassic: argv.includes("--no-classic"),
  verbose: argv.includes("--verbose"),
  only: (() => {
    const i = argv.indexOf("--only");
    return i >= 0 ? argv[i + 1] : null;
  })(),
};

async function main() {
  const seed = Object.entries(withoutComments(await readJson(SEED)));
  const overrides = withoutComments(await readJsonIfExists(OVERRIDES));

  const targets = flags.only ? seed.filter(([id]) => id === String(flags.only)) : seed;
  if (targets.length === 0) {
    console.error(`no seed entry matched --only ${flags.only}`);
    process.exit(1);
  }

  console.log(
    `scraping ${targets.length} zone(s) from warcraft.wiki.gg ` +
      `(era filter ${flags.eraFilter ? "on" : "off"})`
  );

  // Prefer the purpose-written "(Classic)" article wherever the wiki has one.
  const classicIndex = flags.noClassic
    ? new Set()
    : await fetchClassicTitleIndex({ refresh: flags.refresh });
  if (!flags.noClassic) {
    console.log(`${classicIndex.size} Classic-specific page titles available`);
  }

  const entries = [];
  const problems = [];
  let fetched = 0;
  let cached = 0;

  let classicUsed = 0;

  for (const [idStr, meta] of targets) {
    const mapID = Number(idStr);
    const classicTitle = classicVariant(meta.name, classicIndex);
    const title = classicTitle || meta.wiki || meta.name;
    if (classicTitle) classicUsed++;

    let lore;
    try {
      lore = await fetchLoreText(title, {
        refresh: flags.refresh,
        minChars: MIN_INTRO_CHARS,
        eraFilter: flags.eraFilter,
        verbose: flags.verbose,
      });
    } catch (err) {
      problems.push(`${title} (${mapID}): ${err.message}`);
      continue;
    }
    fetched += lore.fetches;
    cached += lore.cacheHits;

    if (lore.missing) {
      problems.push(`${title} (${mapID}): no extract returned -- check the page title`);
      continue;
    }

    const { cleaned, usedSections } = lore;
    const override = overrides[idStr];

    // A hand-written override wins outright, and is the escape hatch for zones
    // whose wiki intro is entirely post-vanilla.
    const full = override?.full ?? cleaned.full;
    if (!full) {
      problems.push(
        `${title} (${mapID}): nothing left after era filtering -- ` +
          `add an entry to tools/seed/overrides.json`
      );
      continue;
    }

    entries.push({
      mapID,
      kind: "zone",
      key: null,
      name: meta.name,
      short: override?.short ?? makeShort(full),
      full,
      // An override is prose written for this project, so it carries no wiki source and
      // is not CC BY-SA. The emitter reads the absence of a source as exactly that.
      source: override?.full ? null : sourceUrl(lore.resolvedTitle),
    });

    const note = [];
    note.push(classicTitle ? "classic" : "|general|");
    if (usedSections) note.push("sections");
    if (override) note.push("override");
    if (cleaned.droppedCount) note.push(`-${cleaned.droppedCount} sentence`);
    console.log(
      `  ${String(mapID).padStart(4)} ${meta.name.padEnd(22)} ` +
        `${String(full.length).padStart(5)} chars` +
        (note.length ? `  (${note.join(", ")})` : "")
    );
  }

  entries.sort((a, b) => a.mapID - b.mapID);

  // Where this lands depends on whether there is a database: rows in lore_line, or the
  // data file directly. See tools/lore/store.mjs -- a --only run is safe against the
  // table and would truncate the file, which is why `partial` exists.
  const result = await persistScrape(entries, { partial: Boolean(flags.only) });
  console.log();
  if (result.target === "database") {
    console.log(
      `recorded ${result.inserted} new version(s): ${result.promoted} promoted, ` +
        `${result.heldBack} held back behind a hand edit, ${result.unchanged} unchanged`,
    );
    if (result.inserted) console.log("write the addon data files with:  make lore-export");
  } else if (result.target === "skipped") {
    console.log("--only run with no database: not writing Data/Zones.lua");
  } else {
    console.log(`wrote Data/Zones.lua (${result.count} zones)`);
  }

  console.log(
    `fetched ${fetched}, from cache ${cached}; ` +
      `${classicUsed}/${entries.length} from a (Classic) page`
  );
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ! ${p}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  // An open pool keeps the process alive after main() returns, which looks like a hang.
  .finally(close);

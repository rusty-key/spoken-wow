#!/usr/bin/env node
// Writes tools/seed/era-areas.json from the Classic Era client's AreaTable, or with --forever
// tools/seed/camelot-areas.json from Forever's.
//
//   node tools/fetch-era-areas.mjs                     # Era's pinned build
//   node tools/fetch-era-areas.mjs --forever           # Forever's pinned build
//   node tools/fetch-era-areas.mjs --build 1.15.9.69109
//
// The lore export keeps the places either client can name (lib/era.mjs loadClientAreas), and
// ForeverAreas.lua lists those only Forever's can: both pins live in pipelines/lib/wago.mjs.
//
// AreaTable is the table GetSubZoneText and MapUtil.FindBestAreaNameAtMouse
// read from, so it is the definitive list of area names the Era client can ever
// report. The wiki's subzone categories mix every era of the game -- Cataclysm's
// Ruins of Auberdine, BfA's warfront Stromgarde, even Plunderstorm -- and 497 of
// the corpus's 1304 subzones turned out not to exist in the client at all.
// Everything that consumes the corpus filters against this seed instead of
// trusting the wiki's idea of what is a place.
//
// The dump comes from wago.tools, which serves Blizzard's own client database
// per build. The result is committed so scrapes and validation stay
// deterministic and offline; re-run this only to move to a newer client build.
//
// One quirk worth knowing: Season of Discovery runs on the same 1.15 client, so
// its areas are in this table too. Almost all of them are phased copies reusing
// vanilla names; the one SoD-only name that reaches the corpus is Storm Cliffs
// in Azshara. Kept deliberately -- the filter's contract is "the client can
// report this name", not "this is vanilla lore".

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ERA_BUILD, FOREVER_BUILD, wagoTable } from "../../lib/wago.mjs";
import { ROOT } from "./lib/wiki.mjs";

const argv = process.argv.slice(2);
const forever = argv.includes("--forever");
const SEED = join(ROOT, "pipelines/places/tools/seed", forever ? "camelot-areas.json" : "era-areas.json");
const build = argv.includes("--build") ? argv[argv.indexOf("--build") + 1] : forever ? FOREVER_BUILD : ERA_BUILD;

async function main() {
  console.log(`fetching AreaTable for ${build}`);
  const rows = await wagoTable("AreaTable", { build });
  if (rows.length && rows[0].AreaName_lang === undefined) {
    throw new Error("AreaTable format changed: no AreaName_lang column");
  }

  const names = new Set();
  for (const row of rows) {
    const name = (row.AreaName_lang || "").trim();
    if (name) names.add(name);
  }

  const seed = {
    _comment: forever
      ? [
          "Every area name the Forever client can report, from its own AreaTable via",
          "wago.tools. The Era seed beside this one is the same thing for Classic Era;",
          "the corpus filter is the union, because the addon ships for both clients and a",
          "place either one can name is a place worth having a line for.",
          "Regenerate with:  node tools/fetch-era-areas.mjs --forever",
        ]
      : [
          "Every area name the Classic Era client can report, from the client's own",
          "AreaTable via wago.tools. The ground truth that keeps post-vanilla places",
          "(which the wiki's subzone categories are full of) out of the corpus.",
          "Regenerate with:  node tools/fetch-era-areas.mjs",
        ],
    build,
    names: [...names].sort(),
  };
  await writeFile(SEED, JSON.stringify(seed, null, 2) + "\n");
  console.log(`wrote ${SEED}: ${names.size} unique area names from build ${build}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

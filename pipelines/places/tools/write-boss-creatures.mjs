#!/usr/bin/env node
// Writes each boss's creature and model onto the boss table from boss_creatures.py's JSON:
//
//   node pipelines/places/tools/write-boss-creatures.mjs <boss_creatures.json>
//
// Every live boss is set, to null where nothing gives it one, so a boss the input no longer covers
// loses its creature rather than keeping a stale one.
// Data/Creatures.lua is written from the table by make bosses-export.
//
// Where the database gives a boss no model, the Adventure Guide's (retail JournalEncounter tables) fills in:
// its creature's model where Forever's client has that model.
// boss-creatures-manual.json then sets the creature and model of the bosses the database cannot give, each
// with its evidence, and fails the run on a model the client does not have.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { guideFinder } from "../../lib/bosses.mjs";
import { FOREVER_BUILD, RETAIL_BUILD, wagoTable } from "../../lib/wago.mjs";
import { close, readBosses, readNames, requireDatabase, setCreature } from "./bosses/store.mjs";
import { loadEnvFile } from "./lib/env.mjs";
import { ROOT } from "./lib/wiki.mjs";

const input = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
if (!input) {
  console.error("usage: write-boss-creatures.mjs <boss_creatures.json>");
  process.exit(1);
}
await loadEnvFile();
try {
  requireDatabase("write-boss-creatures");
  await main();
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await close();
}

async function main() {
  const rows = JSON.parse(await readFile(input, "utf8"));

  const guideEncounters = await wagoTable("JournalEncounter", { build: RETAIL_BUILD, locale: "enUS" });
  const guideCreatures = await wagoTable("JournalEncounterCreature", { build: RETAIL_BUILD, locale: "enUS" });
  const models = new Set((await wagoTable("CreatureDisplayInfo", { build: FOREVER_BUILD, locale: "enUS" })).map((r) => Number(r.ID)));
  const guideOf = guideFinder(guideEncounters);
  const inOrder = (list) => [...list].sort((a, b) => Number(a.OrderIndex) - Number(b.OrderIndex));

  const have = new Map(rows.map((r) => [`${r.map}\t${r.key}`, r]));
  /** The row of the boss `key` of `map`, a new empty one where there is none. */
  function rowFor(map, key) {
    let row = have.get(`${map}\t${key}`);
    if (!row) {
      row = { map, key, creature: null, display: null };
      have.set(`${map}\t${key}`, row);
      rows.push(row);
    }
    return row;
  }
  // A model the client does not have draws an empty portrait: none, so the guide's or the unknown boss's is drawn.
  for (const row of rows) if (row.display && !models.has(row.display)) row.display = null;
  let filledModels = 0;
  const english = await readNames("boss");
  // guideFinder matches by encounter ids, else the English name.
  const bosses = (await readBosses()).map((b) => ({ ...b, ids: b.encounterIds, name: english.get(String(b.id))?.get("enUS") ?? b.key }));
  for (const boss of bosses) {
    const guide = guideOf(boss);
    if (!guide) continue;
    const row = rowFor(boss.map, boss.key);
    if (!row.display) {
      const model = inOrder(guideCreatures.filter((c) => c.JournalEncounterID === guide.ID))
        .map((c) => Number(c.CreatureDisplayInfoID))
        .find((id) => id && models.has(id));
      if (model) {
        row.display = model;
        filledModels++;
      }
    }
  }
  // Creatures only Forever has, known from Efficient Games' records of the fight, are not in the database, and a
  // few of its creatures are drawn with another model in Forever than the database's.
  const fixed = JSON.parse(await readFile(join(ROOT, "pipelines/places/tools/boss-creatures-manual.json"), "utf8"));
  const known = new Set(bosses.map((b) => `${b.map}\t${b.key}`));
  for (const entry of fixed) {
    const at = `${entry.map}\t${entry.key}`;
    if (!known.has(at)) throw new Error(`boss-creatures-manual.json: ${entry.map} "${entry.key}" is not a live boss in the boss table`);
    if (entry.display && !models.has(entry.display)) {
      throw new Error(`boss-creatures-manual.json: ${entry.key}'s display ${entry.display} is not in the client's CreatureDisplayInfo`);
    }
    const row = rowFor(entry.map, entry.key);
    if ("creature" in entry) row.creature = entry.creature;
    if ("display" in entry) row.display = entry.display;
  }
  const counts = { updated: 0, unchanged: 0 };
  for (const boss of bosses) {
    const row = have.get(`${boss.map}\t${boss.key}`);
    counts[await setCreature(boss.map, boss.key, row?.creature ?? null, row?.display ?? null)]++;
  }
  console.log(`${counts.updated} bosses updated, ${counts.unchanged} unchanged (guide: ${filledModels} models; by hand: ${fixed.length} creatures)`);
  const unknown = rows.filter((r) => (r.creature || r.display) && !known.has(`${r.map}\t${r.key}`));
  for (const r of unknown) console.log(`not a live boss, skipped: ${r.map} "${r.key}"`);
  if (counts.updated > 0) console.log("then: make bosses-export");
}

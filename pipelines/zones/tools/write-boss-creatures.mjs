#!/usr/bin/env node
// Writes Data/Creatures.lua for Spoken NPCs from boss_creatures.py's JSON:
//
//   node pipelines/zones/tools/write-boss-creatures.mjs <boss_creatures.json> [--abilities <boss-abilities.json>] [--manual <boss-abilities-manual.json>] [--out <file>]
//
// The client's tables (wago.tools, Forever's build) drop the spells it has no name for and the
// passive ones, and repeats of a name (the lowest id of a name stays); the first MOST by id are kept.
// Where the database gives a boss no model or no spells, the Adventure Guide's (retail JournalEncounter
// tables) fill in: its creature's model where Forever's client has that model, its abilities that name a spell.
// boss-creatures-manual.json then sets the creature and model of the bosses the database cannot give, each
// with its evidence, and fails the run on a model the client does not have.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { guideFinder, readBosses } from "../../lib/bosses.mjs";
import { quote } from "../../lib/dungeons.mjs";
import { FOREVER_BUILD, RETAIL_BUILD, wagoTable } from "../../lib/wago.mjs";
import { ROOT } from "./lib/wiki.mjs";

const args = process.argv.slice(2);
const input = args[0] && !args[0].startsWith("--") ? args[0] : null;
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : join(ROOT, "addons/Spoken_NPCs/Data/Creatures.lua");
if (!input) throw new Error("usage: write-boss-creatures.mjs <boss_creatures.json> [--out file]");

const MOST = 8;
const PASSIVE = 0x40;
const rows = JSON.parse(await readFile(input, "utf8"));
const names = new Map((await wagoTable("SpellName", { build: FOREVER_BUILD, locale: "enUS" })).map((r) => [Number(r.ID), r.Name_lang]));
const attributes = new Map((await wagoTable("SpellMisc", { build: FOREVER_BUILD, locale: "enUS" })).map((r) => [Number(r.SpellID), Number(r.Attributes_0)]));
const junk = /^(DNT|zz|\[|OLD|DEPRECATED|TEST|Test|\(OLD\))|\(OLD\)|\(DND\)|\(DNT\)/;


const guideEncounters = await wagoTable("JournalEncounter", { build: RETAIL_BUILD, locale: "enUS" });
const guideCreatures = await wagoTable("JournalEncounterCreature", { build: RETAIL_BUILD, locale: "enUS" });
const guideSections = await wagoTable("JournalEncounterSection", { build: RETAIL_BUILD, locale: "enUS" });
const models = new Set((await wagoTable("CreatureDisplayInfo", { build: FOREVER_BUILD, locale: "enUS" })).map((r) => Number(r.ID)));
const guideOf = guideFinder(guideEncounters);
const inOrder = (list) => [...list].sort((a, b) => Number(a.OrderIndex) - Number(b.OrderIndex));

const have = new Map(rows.map((r) => [`${r.map}\t${r.key}`, r]));
/** The row of the boss `key` of `map`, a new empty one where there is none. */
function rowFor(map, key) {
  let row = have.get(`${map}\t${key}`);
  if (!row) {
    row = { map, key, creature: null, display: null, spells: [] };
    have.set(`${map}\t${key}`, row);
    rows.push(row);
  }
  return row;
}
// A model the client does not have draws an empty portrait: none, so the guide's or the unknown boss's is drawn.
for (const row of rows) if (row.display && !models.has(row.display)) row.display = null;
let filledModels = 0;
let filledSpells = 0;
const bosses = await readBosses();
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
  if (row.spells.length === 0) {
    const spells = inOrder(guideSections.filter((s) => s.JournalEncounterID === guide.ID && s.Type === "2"))
      .map((s) => Number(s.SpellID))
      .filter(Boolean);
    if (spells.length) {
      row.spells = spells;
      filledSpells++;
    }
  }
}
// The spells in the boss's wiki article come first, then what the database and the guide hold.
const wiki = args.includes("--abilities") ? JSON.parse(await readFile(args[args.indexOf("--abilities") + 1], "utf8")) : [];
let filledWiki = 0;
for (const entry of wiki) {
  const row = rowFor(entry.map, entry.key);
  row.spells = [...new Set([...entry.spells, ...row.spells])];
  filledWiki++;
}
// Spell ids chosen by hand for bosses whose article lists abilities without ids: ahead of the rest.
const manual = args.includes("--manual") ? JSON.parse(await readFile(args[args.indexOf("--manual") + 1], "utf8")) : [];
let filledManual = 0;
for (const entry of manual) {
  if (!entry.spells?.length) continue;
  const row = rowFor(entry.map, entry.key);
  row.spells = [...new Set([...entry.spells, ...row.spells])];
  filledManual++;
}
// Creatures only Forever has, known from Efficient Games' records of the fight, are not in the database, and a
// few of its creatures are drawn with another model in Forever than the database's.
const fixed = JSON.parse(await readFile(join(ROOT, "pipelines/zones/tools/boss-creatures-manual.json"), "utf8"));
const known = new Set(bosses.map((b) => `${b.map}\t${b.key}`));
for (const entry of fixed) {
  const at = `${entry.map}\t${entry.key}`;
  if (!known.has(at)) throw new Error(`boss-creatures-manual.json: ${entry.map} "${entry.key}" is not a boss in Data/Bosses.lua`);
  if (entry.display && !models.has(entry.display)) {
    throw new Error(`boss-creatures-manual.json: ${entry.key}'s display ${entry.display} is not in the client's CreatureDisplayInfo`);
  }
  const row = rowFor(entry.map, entry.key);
  if ("creature" in entry) row.creature = entry.creature;
  if ("display" in entry) row.display = entry.display;
}
rows.splice(0, rows.length, ...rows.filter((r) => r.creature || r.display || r.spells.length));

const maps = {};
let withSpells = 0;
for (const row of rows) {
  const seen = new Set();
  const spells = [];
  for (const id of row.spells) {
    const name = names.get(id);
    if (!name || junk.test(name) || seen.has(name)) continue;
    if ((attributes.get(id) ?? 0) & PASSIVE) continue;
    seen.add(name);
    spells.push(id);
  }
  withSpells += spells.length > 0;
  (maps[row.map] ??= []).push({ key: row.key, creature: row.creature, display: row.display, spells: spells.slice(0, MOST) });
}

const lines = [
  "-- GENERATED by pipelines/zones/tools/write-boss-creatures.mjs from boss_creatures.py (the Forever repack's world",
  `-- database) and the client's own tables (${FOREVER_BUILD}, wago.tools). Regenerate by running both.`,
  "--",
  "-- SpokenBossCreatures[instance map][boss key] = { creature = the boss's creature id (nil where only the guide",
  "-- knows the boss), display = its first model's display id (nil where there is none), spells = { spell ids } }:",
  "-- its portrait, and what the database says it casts. A boss with no creature here has no portrait; one with",
  "-- no spells has none listed. Never the whole fight: the rest is cast by code the database does not hold.",
  "",
  "SpokenBossCreatures = {",
];
for (const map of Object.keys(maps).map(Number).sort((a, b) => a - b)) {
  lines.push(`\t[${map}] = {`);
  for (const boss of maps[map].sort((a, b) => a.key.localeCompare(b.key))) {
    lines.push(`\t\t[${quote(boss.key)}] = { creature = ${boss.creature ?? "nil"}, display = ${boss.display ?? "nil"}, spells = { ${boss.spells.join(", ")} } },`);
  }
  lines.push("\t},");
}
lines.push("}", "");
await writeFile(OUT, lines.join("\r\n"), "utf8");
console.log(rows.length, "bosses,", withSpells, "with spells ->", OUT, `(guide: ${filledModels} models, ${filledSpells} spell lists; wiki: ${filledWiki} bosses; by hand: ${filledManual} spell lists, ${fixed.length} creatures)`);

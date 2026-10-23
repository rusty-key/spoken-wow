#!/usr/bin/env node
// Writes Data/Creatures.lua for Spoken NPCs from boss_creatures.py's JSON:
//
//   node pipelines/places/tools/write-boss-creatures.mjs <boss_creatures.json> [--abilities <boss-abilities.json>] [--manual <boss-abilities-manual.json>] [--out <file>]
//
// The client's tables (wago.tools, Forever's build) drop the spells it has no name for, the passive and the
// hidden ones, and repeats of a name (the first id of a name stays). Of more than MOST, the ones chosen by hand
// and the ones the database or Efficient Games has the boss cast are kept before the rest.
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
// SpellMisc Attributes[0] "do not display": selectors and permanent auras (King Gordok's breath selection).
const HIDDEN = 0x80;
const rows = JSON.parse(await readFile(input, "utf8"));
const names = new Map((await wagoTable("SpellName", { build: FOREVER_BUILD, locale: "enUS" })).map((r) => [Number(r.ID), r.Name_lang]));
const attributes = new Map((await wagoTable("SpellMisc", { build: FOREVER_BUILD, locale: "enUS" })).map((r) => [Number(r.SpellID), Number(r.Attributes_0)]));
// The Dire Maul guards' "Zul'Gurub Talisman PAL R1 DND" is a quest's, called from their actionlists.
const junk = /^(DNT|zz|\[|OLD|DEPRECATED|TEST|Test|\(OLD\))|\(OLD\)|\(DND\)|\(DNT\)| DND$/;
// Spells any creature may cast, never a boss's own ability: Dazed (a hit from behind), Battle Stance, the
// dragons' Summon Player. Out of every boss, wherever its sources got them.
const GENERIC = new Set([1604, 7165, 24776]);

const guideEncounters = await wagoTable("JournalEncounter", { build: RETAIL_BUILD, locale: "enUS" });
const guideCreatures = await wagoTable("JournalEncounterCreature", { build: RETAIL_BUILD, locale: "enUS" });
const guideSections = await wagoTable("JournalEncounterSection", { build: RETAIL_BUILD, locale: "enUS" });
const models = new Set((await wagoTable("CreatureDisplayInfo", { build: FOREVER_BUILD, locale: "enUS" })).map((r) => Number(r.ID)));
const guideOf = guideFinder(guideEncounters);
const inOrder = (list) => [...list].sort((a, b) => Number(a.OrderIndex) - Number(b.OrderIndex));

// What the database has the boss cast, and what Efficient Games recorded it casting in Forever, after it.
for (const row of rows) {
  row.spells = [...new Set([...row.spells, ...(row.live ?? [])])];
  row.cast = new Set(row.spells);
}
const have = new Map(rows.map((r) => [`${r.map}\t${r.key}`, r]));
/** The spells of `ids` the card shows: named in the client, not junk, generic, dropped by hand, passive or hidden,
 * and one of each name (the first id of a name stays). */
function usable(row, ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const name = names.get(id);
    if (!name || junk.test(name) || seen.has(name) || GENERIC.has(id) || row.drop?.has(id)) continue;
    if ((attributes.get(id) ?? 0) & (PASSIVE | HIDDEN)) continue;
    seen.add(name);
    out.push(id);
  }
  return out;
}
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
// boss-abilities-manual.json: the spell ids chosen by hand for bosses whose article lists abilities without ids, ahead
// of the rest, and `drop`: ids a source gives the boss that are not its own (an add's, a wrong wiki id, a visual).
// Its drops are read first, so the guide fills a boss whose sources give it nothing the card would show. Several
// entries of one boss add to each other.
const manual = args.includes("--manual") ? JSON.parse(await readFile(args[args.indexOf("--manual") + 1], "utf8")) : [];
for (const entry of manual) {
  if (!entry.drop?.length) continue;
  const row = rowFor(entry.map, entry.key);
  row.drop = new Set([...(row.drop ?? []), ...entry.drop]);
}
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
  if (usable(row, row.spells).length === 0) {
    const spells = inOrder(guideSections.filter((s) => s.JournalEncounterID === guide.ID && s.Type === "2"))
      .map((s) => Number(s.SpellID))
      .filter(Boolean);
    if (spells.length) {
      row.spells = [...new Set([...row.spells, ...spells])];
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
let filledManual = 0;
for (const entry of manual) {
  if (!entry.spells?.length) continue;
  const row = rowFor(entry.map, entry.key);
  row.spells = [...new Set([...entry.spells, ...row.spells])];
  row.chosen = new Set([...(row.chosen ?? []), ...entry.spells]);
  filledManual++;
}
// Creatures only Forever has, known from Efficient Games' records of the fight, are not in the database, and a
// few of its creatures are drawn with another model in Forever than the database's.
const fixed = JSON.parse(await readFile(join(ROOT, "pipelines/places/tools/boss-creatures-manual.json"), "utf8"));
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
  const spells = usable(row, row.spells);
  // By name: the wiki's id of a name often stands for the one the database casts.
  const cast = new Set([...(row.cast ?? [])].map((id) => names.get(id)));
  const sure = spells.filter((id) => row.chosen?.has(id) || cast.has(names.get(id)));
  const kept = new Set([...sure, ...spells.filter((id) => !sure.includes(id))].slice(0, MOST));
  withSpells += spells.length > 0;
  (maps[row.map] ??= []).push({ key: row.key, creature: row.creature, display: row.display, spells: spells.filter((id) => kept.has(id)) });
}

const lines = [
  "-- GENERATED by pipelines/places/tools/write-boss-creatures.mjs from boss_creatures.py (the Forever repack's world",
  `-- database) and the client's own tables (${FOREVER_BUILD}, wago.tools). Regenerate by running both.`,
  "--",
  "-- SpokenBossCreatures[instance map][boss key] = { creature = the boss's creature id (nil where only the guide",
  "-- knows the boss), display = its first model's display id (nil where there is none), spells = { spell ids } }:",
  "-- its portrait, and what its wiki article, the database and Efficient Games' records of Forever say it casts. A",
  "-- boss with no creature here has no portrait; one with no spells has none listed. Never the whole fight.",
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

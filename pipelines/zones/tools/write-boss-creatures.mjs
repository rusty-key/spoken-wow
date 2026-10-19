#!/usr/bin/env node
// Writes Data/Creatures.lua for Spoken NPCs from boss_creatures.py's JSON:
//
//   node pipelines/zones/tools/write-boss-creatures.mjs <boss_creatures.json> [--abilities <boss-abilities.json>] [--manual <boss-abilities-manual.json>] [--out <file>]
//
// The client's tables (wago.tools, Forever's build) drop the spells it has no name for and the
// passive ones, and repeats of a name (the lowest id of a name stays); the first MOST by id are kept.
// Where the database gives a boss no model or no spells, the Adventure Guide's (retail JournalEncounter
// tables) fill in: its creature's model where Forever's client has that model, its abilities that name a spell.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FOREVER_BUILD, wagoTable } from "../../lib/wago.mjs";

const RETAIL_BUILD = "12.1.5.70448";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
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

/** [{ map, key, name, ids }] from Data/Bosses.lua. */
async function readBosses() {
  const text = await readFile(join(ROOT, "addons/Spoken_NPCs/Data/Bosses.lua"), "utf8");
  const out = [];
  let map = null;
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(/^\t\t\[(\d+)\] = \{/);
    if (head) {
      map = Number(head[1]);
      continue;
    }
    const boss = line.match(/\{ id = \d+, ids = \{([^}]*)\}, key = "([^"]+)", "((?:[^"\\]|\\.)*)"/);
    if (boss && map !== null) {
      out.push({ map, key: boss[2], name: boss[3].replace(/\\(.)/g, "$1"), ids: boss[1].split(",").map((n) => Number(n.trim())) });
    }
  }
  return out;
}

const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const guideEncounters = await wagoTable("JournalEncounter", { build: RETAIL_BUILD, locale: "enUS" });
const guideCreatures = await wagoTable("JournalEncounterCreature", { build: RETAIL_BUILD, locale: "enUS" });
const guideSections = await wagoTable("JournalEncounterSection", { build: RETAIL_BUILD, locale: "enUS" });
const models = new Set((await wagoTable("CreatureDisplayInfo", { build: FOREVER_BUILD, locale: "enUS" })).map((r) => Number(r.ID)));
const byDE = new Map(guideEncounters.map((r) => [Number(r.DungeonEncounterID), r]));
const byName = new Map(guideEncounters.map((r) => [flat(r.Name_lang), r]));
const guideOf = (boss) => boss.ids.map((id) => byDE.get(id)).find(Boolean) ?? byName.get(flat(boss.name));
const inOrder = (list) => [...list].sort((a, b) => Number(a.OrderIndex) - Number(b.OrderIndex));

const have = new Map(rows.map((r) => [`${r.map}\t${r.key}`, r]));
let filledModels = 0;
let filledSpells = 0;
for (const boss of await readBosses()) {
  const guide = guideOf(boss);
  if (!guide) continue;
  let row = have.get(`${boss.map}\t${boss.key}`);
  if (!row) {
    row = { map: boss.map, key: boss.key, creature: null, display: null, spells: [] };
    have.set(`${boss.map}\t${boss.key}`, row);
    rows.push(row);
  }
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
  let row = have.get(`${entry.map}\t${entry.key}`);
  if (!row) {
    row = { map: entry.map, key: entry.key, creature: null, display: null, spells: [] };
    have.set(`${entry.map}\t${entry.key}`, row);
    rows.push(row);
  }
  row.spells = [...new Set([...entry.spells, ...row.spells])];
  filledWiki++;
}
// Spell ids chosen by hand for bosses whose article lists abilities without ids: ahead of the rest.
const manual = args.includes("--manual") ? JSON.parse(await readFile(args[args.indexOf("--manual") + 1], "utf8")) : [];
let filledManual = 0;
for (const entry of manual) {
  if (!entry.spells?.length) continue;
  let row = have.get(`${entry.map}	${entry.key}`);
  if (!row) {
    row = { map: entry.map, key: entry.key, creature: null, display: null, spells: [] };
    have.set(`${entry.map}	${entry.key}`, row);
    rows.push(row);
  }
  row.spells = [...new Set([...entry.spells, ...row.spells])];
  filledManual++;
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
    lines.push(`\t\t["${boss.key.replace(/(["\\])/g, "\\$1")}"] = { creature = ${boss.creature ?? "nil"}, display = ${boss.display ?? "nil"}, spells = { ${boss.spells.join(", ")} } },`);
  }
  lines.push("\t},");
}
lines.push("}", "");
await writeFile(OUT, lines.join("\r\n"), "utf8");
console.log(rows.length, "bosses,", withSpells, "with spells ->", OUT, `(guide: ${filledModels} models, ${filledSpells} spell lists; wiki: ${filledWiki} bosses; by hand: ${filledManual})`);

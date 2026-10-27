// The bosses of the dungeons and raids, from the client's own table (wago.mjs, cached).
//
// Run on its own, this writes addons/Spoken_NPCs/Data/Bosses.lua: for each instance map in
// dungeons.json, its bosses in Forever's order, each with its name in every language, from
// Forever's DungeonEncounter table (retail's where wago has none of Forever's strings in a
// language). A boss the client lists once for each difficulty (Season of Discovery's raid-sized
// Blackfathom Deeps and Gnomeregan, Sunken Temple's phases) is one boss here. Stories are not in the client: they are data of the site, and arrive in
// Data/Stories.lua.
//
//   node pipelines/lib/bosses.mjs          (make bosses)
//   node pipelines/lib/bosses.mjs --check  fails where the file is not what this would write

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { LOCALES, loadDungeons, quote } from "./dungeons.mjs";
import { FOREVER_BUILD, RETAIL_BUILD, wagoTable } from "./wago.mjs";

const OUT = fileURLToPath(new URL("../../addons/Spoken_NPCs/Data/Bosses.lua", import.meta.url));
const RENAMED = fileURLToPath(new URL("./boss-names.json", import.meta.url));

/** A name as the tools match one to another: lowercased, letters and digits only. */
export const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The longest a boss's story from the wiki is kept, in characters, cut at a paragraph. */
export const STORY_MAX_CHARS = 1800;

/** (boss) => its row of the Adventure Guide's JournalEncounter `encounters`: by its encounter ids,
 * else by its name. */
export function guideFinder(encounters) {
  const byId = new Map(encounters.map((r) => [Number(r.DungeonEncounterID), r]));
  const byName = new Map(encounters.map((r) => [flat(r.Name_lang), r]));
  return (boss) => boss.ids.map((id) => byId.get(id)).find(Boolean) ?? byName.get(flat(boss.name));
}

/** [{ map, key, name, ids }] from Data/Bosses.lua, as render() writes it. */
export async function readBosses(path = OUT) {
  const text = await readFile(path, "utf8");
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

// Names the client spells two ways for one boss (Blackfathom Deeps' Gelihast is Geilhast in the
// Season of Discovery's rows): the second is the first.
const SAME = { geilhast: "gelihast" };

// Encounters the client lists that no Forever source shows as a boss of its dungeon (Season of Discovery's
// raid-sized fights, a vault with no creature, a name that is the raid's own): left out until a source confirms them.
const UNCONFIRMED = {
  90: ["mechanical menagerie"],
  109: ["festering rotslime", "atalai defenders"],
  230: ["the vault"],
  409: ["the molten core"],
  2875: ["three little wolves"],
  2959: ["mana wraith"],
};

// Forever's own difficulties: the client's other rows are Season of Discovery's. Forever splits one
// dungeon's bosses over both, on one OrderIndex scale (Gnomeregan's Grubbis, difficulty 1, comes first).
const FOREVER_DIFFICULTIES = new Set([0, 1]);

/** A boss's key: its English name lowercased, apostrophes and punctuation dropped, as the places' keys are. */
export function keyOf(name) {
  const key = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return SAME[key] ?? key;
}

/**
 * The bosses of one map from its DungeonEncounter rows ({ ID, Name_lang, DifficultyID, OrderIndex }):
 * each name once, and without a "A and B" row where A or B is a boss of the map on its own. Its id
 * and name are those of the difficulty that lists the most of them; its place is Forever's, the
 * OrderIndex of its difficulty 0 and 1 rows, with a boss that has none after those that do.
 * Returns [{ id, ids, key, name }]: `id` the first row's, `ids` every row's, of every difficulty (the
 * ids the game's ENCOUNTER_START gives), a combined row's too.
 */
export function bossesOf(rows) {
  const perDifficulty = new Map();
  for (const row of rows) {
    const list = perDifficulty.get(row.DifficultyID) ?? [];
    list.push(row);
    perDifficulty.set(row.DifficultyID, list);
  }
  const byCount = [...perDifficulty.entries()].sort((a, b) => b[1].length - a[1].length || Number(a[0]) - Number(b[0]));
  const seen = new Map();
  const place = new Map();
  for (const [, list] of byCount) {
    for (const row of [...list].sort((a, b) => Number(a.OrderIndex) - Number(b.OrderIndex) || Number(a.ID) - Number(b.ID))) {
      const key = keyOf(row.Name_lang);
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, { id: Number(row.ID), ids: [], key, name: row.Name_lang });
      const boss = seen.get(key);
      if (!boss.ids.includes(Number(row.ID))) boss.ids.push(Number(row.ID));
      if (FOREVER_DIFFICULTIES.has(Number(row.DifficultyID))) {
        place.set(key, Math.min(place.get(key) ?? Infinity, Number(row.OrderIndex)));
      }
    }
  }
  const at = (boss) => place.get(boss.key) ?? Number.MAX_SAFE_INTEGER;
  const all = [...seen.values()].sort((a, b) => at(a) - at(b));
  return all.filter((boss) => {
    const parts = boss.name.split(/ and /);
    if (parts.length < 2) return true;
    const owners = all.filter((other) => other !== boss && parts.some((part) => other.name.startsWith(part)));
    if (owners.length === 0) return true;
    for (const owner of owners) for (const id of boss.ids) if (!owner.ids.includes(id)) owner.ids.push(id);
    return false;
  });
}

/**
 * Bosses the game names as their creature, not as the encounter (boss-names.json: Forever's The Baron
 * for The Butcher, Kirtonos the Herald): the creature's names, in the languages the database has; the
 * other languages show the English. The key stays the encounter's.
 */
export function renameAsCreatures(maps, names, renamed) {
  for (const boss of Object.values(maps).flat()) {
    const row = renamed[boss.id];
    if (!row) continue;
    boss.name = row.names.enUS;
    for (const locale of LOCALES) {
      if (row.names[locale]) names[locale][boss.id] = row.names[locale];
      else delete names[locale]?.[boss.id];
    }
  }
}

/**
 * Forever's DungeonEncounter rows `english` named in a language from retail's rows: by the encounter's
 * id, else, for an encounter only Forever has, by its English name in retail's `retailEnglish`.
 * Returns [{ ID, Name_lang }], one for each of `english` that retail names.
 */
export function retailRows(english, retailEnglish, retailLocale) {
  const byId = new Map(retailLocale.map((row) => [row.ID, row.Name_lang]));
  const byName = new Map();
  for (const row of retailEnglish) if (byId.has(row.ID) && !byName.has(row.Name_lang)) byName.set(row.Name_lang, byId.get(row.ID));
  return english
    .map((row) => ({ ID: row.ID, Name_lang: byId.get(row.ID) ?? byName.get(row.Name_lang) }))
    .filter((row) => row.Name_lang);
}

/** The Lua file: `maps` is { map: [{ id, key, name }] }, `names` { locale: { id: name } }. */
export function render(maps, names) {
  const blocks = Object.keys(maps).map(Number).sort((a, b) => a - b).map((map) => {
    const lines = maps[map].map((boss) => {
      const ids = [...boss.ids].sort((a, b) => a - b);
      const parts = [`id = ${boss.id}`, `ids = { ${ids.join(", ")} }`, `key = ${quote(boss.key)}`, quote(boss.name)];
      for (const locale of LOCALES) {
        const name = names[locale]?.[boss.id];
        if (name && name !== boss.name) parts.push(`${locale} = ${quote(name)}`);
      }
      return `\t\t\t{ ${parts.join(", ")} },`;
    });
    return `\t\t[${map}] = {\n${lines.join("\n")}\n\t\t},`;
  });
  return `-- AUTO-GENERATED by pipelines/lib/bosses.mjs from the client's DungeonEncounter table and
-- pipelines/lib/dungeons.json. Do not edit by hand.
--
-- The bosses of each dungeon and raid, by instance map, in Forever's order: \`id\`
-- the client's encounter, \`ids\` every encounter the client has for it, one for each difficulty
-- (the ids ENCOUNTER_START gives), \`key\` the boss's English name lowercased without punctuation (how its
-- story is filed), then its name, and in every other language where it differs (Forever
-- ${FOREVER_BUILD}, else retail ${RETAIL_BUILD}, wago.tools). Regenerate with:
--   make bosses
--
-- A global rather than a private namespace: a data file cannot reach into the addon's environment.

SpokenBosses = {
\tversion = 1,

\tmaps = {
${blocks.join("\n")}
\t},
}
`;
}

async function main() {
  const { dungeons: instances, worldBosses } = loadDungeons();
  const dungeons = { ...instances, ...worldBosses };
  const english = await wagoTable("DungeonEncounter", { build: FOREVER_BUILD, locale: "enUS" });
  const byMap = new Map();
  for (const row of english) {
    const map = Number(row.MapID);
    if (!dungeons[map]) continue;
    const list = byMap.get(map) ?? [];
    list.push(row);
    byMap.set(map, list);
  }
  const maps = {};
  for (const [map, rows] of byMap) maps[map] = bossesOf(rows).filter((boss) => !UNCONFIRMED[map]?.includes(boss.key));

  const wanted = new Set(Object.values(maps).flat().map((boss) => boss.id));
  const englishOf = new Map(english.map((row) => [Number(row.ID), row.Name_lang]));
  let retailEnglish;
  const names = {};
  for (const locale of LOCALES) {
    names[locale] = {};
    let rows = await wagoTable("DungeonEncounter", { build: FOREVER_BUILD, locale });
    // A build wago has no strings of for the locale serves English (Forever's itIT): retail's then.
    if (rows.every((row) => row.Name_lang === englishOf.get(Number(row.ID)))) {
      retailEnglish ??= await wagoTable("DungeonEncounter", { build: RETAIL_BUILD, locale: "enUS" });
      rows = retailRows(english, retailEnglish, await wagoTable("DungeonEncounter", { build: RETAIL_BUILD, locale }));
    }
    for (const row of rows) {
      const id = Number(row.ID);
      if (wanted.has(id) && row.Name_lang) names[locale][id] = row.Name_lang;
    }
  }
  renameAsCreatures(maps, names, JSON.parse(await readFile(RENAMED, "utf8")).renamed);
  const text = render(maps, names);
  if (process.argv.includes("--check")) {
    const current = (await readFile(OUT, "utf8")).replace(/\r\n/g, "\n");
    if (current !== text) {
      console.error(`${OUT} is not what the client's table gives: run make bosses`);
      process.exit(1);
    }
    console.log(`${OUT} is up to date`);
    return;
  }
  await writeFile(OUT, text);
  const count = Object.values(maps).reduce((sum, list) => sum + list.length, 0);
  console.log(`wrote ${count} bosses in ${Object.keys(maps).length} instances to ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

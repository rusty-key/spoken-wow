// The bosses of the dungeons and raids, from the client's own table (wago.mjs, cached).
//
// Run on its own, this brings the boss tables (boss_instance, boss and the 'boss' and
// 'instance' names of entity_name) into step with the client: for each instance map in
// dungeons.json, its bosses in Forever's order, each with its name in every language, from
// Forever's DungeonEncounter table (retail's where wago has none of Forever's strings in a
// language). A boss the client lists once for each difficulty (Season of Discovery's raid-sized
// Blackfathom Deeps and Gnomeregan, Sunken Temple's phases) is one boss here. A boss is matched
// by its encounter id, so one the game renames keeps its key and its stories; one the client
// drops, or one in UNCONFIRMED, is retired. Stories are not in the client: they are data of the
// site. Data/Bosses.lua is written from the tables by make bosses-export.
//
//   node pipelines/lib/bosses.mjs          (make bosses-extract)
//   node pipelines/lib/bosses.mjs --check  lists what the client would change, and fails if anything

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { LOCALES, loadDungeons, quote } from "./dungeons.mjs";
import { FOREVER_BUILD, RETAIL_BUILD, wagoTable } from "./wago.mjs";

const EXPORT = fileURLToPath(new URL("../../addons/Spoken_Bosses/Data/Bosses.lua", import.meta.url));
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

/**
 * [{ map, key, name, ids }] from Data/Bosses.lua, as render() writes it. The file is the export of
 * the boss tables (make bosses-export); the tools that call this only read bosses, so they read the
 * export and run without a database.
 */
export async function readBosses(path = EXPORT) {
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
  return `-- AUTO-GENERATED by pipelines/places/tools/bosses/export.mjs from the boss tables. Do not edit by hand.
--
-- The bosses of each dungeon and raid, by instance map, in Forever's order: \`id\`
-- the client's encounter, \`ids\` every encounter the client has for it, one for each difficulty
-- (the ids ENCOUNTER_START gives), \`key\` the boss's English name lowercased without punctuation (how its
-- story is filed), then its name, and in every other language where it differs (Forever
-- ${FOREVER_BUILD}, else retail ${RETAIL_BUILD}, wago.tools). Regenerate with:
--   make bosses-export
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
  const checkOnly = process.argv.includes("--check");
  // Imported here, not at the top: the tools that import this module for keyOf or readBosses
  // run without pg installed.
  const { loadEnvFile } = await import("../places/tools/lib/env.mjs");
  const store = await import("../places/tools/bosses/store.mjs");
  const { bossChanges, nameChanges, reconcileBosses } = await import("../places/tools/bosses/reconcile.mjs");
  await loadEnvFile();
  try {
    // Before the client's tables are fetched, so a clone with no database learns it at once.
    store.requireDatabase("make bosses-extract");
    await sync(store, { bossChanges, nameChanges, reconcileBosses }, checkOnly);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await store.close();
  }
}

async function sync(store, { bossChanges, nameChanges, reconcileBosses }, checkOnly) {
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

  // Instance names as dungeons.mjs reads them, from the client's Map table.
  const mapNames = {};
  for (const locale of ["enUS", ...LOCALES]) {
    mapNames[locale] = {};
    for (const row of await wagoTable("Map", { build: FOREVER_BUILD, locale })) {
      const map = Number(row.ID);
      if (dungeons[map] && row.MapName_lang) mapNames[locale][map] = row.MapName_lang;
    }
  }

  const order = Object.keys(dungeons).map(Number).sort((a, b) => a - b);
  const instanceRows = order.map((map, position) => ({
    map,
    kind: worldBosses[map] ? "world" : "dungeon",
    zone: dungeons[map].zone,
    storyMap: dungeons[map].story?.[0] ?? null,
    storyKey: dungeons[map].story?.[1] ?? null,
    position,
  }));
  const clientBosses = order.flatMap((map) =>
    (maps[map] ?? []).map((boss, position) => ({ id: boss.id, ids: boss.ids, map, name: boss.name, key: boss.key, position })));

  const existing = await store.readBosses({ includeRetired: true });
  const { upserts, retire } = reconcileBosses(existing, clientBosses);
  // bossZones is keyed by the boss's key, which for a renamed boss is the stored one.
  for (const row of upserts) row.zone = worldBosses[row.map]?.bossZones?.[row.key] ?? null;

  // upserts[i] is clientBosses[i]: the row's id is the stored boss's, the names the client's.
  const wantedNames = [];
  upserts.forEach((row, i) => {
    const boss = clientBosses[i];
    wantedNames.push({ kind: "boss", id: String(row.id), lang: "enUS", name: boss.name, existed: existing.some((e) => e.id === row.id) });
    for (const locale of LOCALES) {
      const name = names[locale][boss.id];
      if (name) wantedNames.push({ kind: "boss", id: String(row.id), lang: locale, name });
    }
  });
  for (const map of order) {
    const en = mapNames.enUS[map] || dungeons[map].name;
    wantedNames.push({ kind: "instance", id: String(map), lang: "enUS", name: en });
    for (const locale of LOCALES) {
      if (mapNames[locale][map]) wantedNames.push({ kind: "instance", id: String(map), lang: locale, name: mapNames[locale][map] });
    }
  }
  const current = { boss: await store.readNameState("boss"), instance: await store.readNameState("instance") };

  const instancesBefore = new Map((await store.readInstances()).map((r) => [r.map, r]));
  const instancesChanged = instanceRows.filter((r) => {
    const was = instancesBefore.get(r.map);
    return !was || ["kind", "zone", "storyMap", "storyKey", "position"].some((k) => was[k] !== r[k]);
  });
  const bosses = bossChanges(existing, upserts);
  const changedNames = nameChanges(current, wantedNames);
  const renamed = changedNames.filter((n) => n.kind === "boss" && n.lang === "enUS" && n.existed);

  const keyOfId = new Map([...existing, ...upserts].map((b) => [b.id, `${b.map} "${b.key}"`]));
  const lines = [
    ...instancesChanged.map((r) => `instance ${r.map}: ${instancesBefore.has(r.map) ? "changed" : "new"}`),
    ...bosses.inserted.map((b) => `boss ${b.map} "${b.key}" (${b.id}): new`),
    ...bosses.updated.map((b) => `boss ${b.map} "${b.key}" (${b.id}): changed`),
    ...retire.map((id) => `boss ${keyOfId.get(id)} (${id}): retired`),
    ...changedNames.map((n) => `${n.kind} ${n.kind === "boss" ? keyOfId.get(Number(n.id)) : n.id} ${n.lang}: ${JSON.stringify(n.name)}`),
  ];
  const counts = (verb) =>
    `${verb}: ${instancesChanged.length} instances, ${bosses.inserted.length} inserted, ${bosses.updated.length} changed, ` +
    `${renamed.length} renamed, ${retire.length} retired, ${changedNames.length} names changed`;

  if (checkOnly) {
    for (const line of lines) console.log(line);
    if (lines.length > 0) {
      console.error(`${counts("the client differs from the boss tables")}: run make bosses-extract`);
      process.exitCode = 1;
    } else {
      console.log("the boss tables match the client's DungeonEncounter table");
    }
    return;
  }

  await store.upsertInstances(instanceRows);
  await store.writeBosses({ upserts, retire });
  let keptEdits = 0;
  for (const n of changedNames) {
    if ((await store.recordName(n.kind, n.id, n.lang, n.name)) === "kept-edit") keptEdits++;
  }
  console.log(counts("wrote"));
  if (keptEdits > 0) console.log(`${keptEdits} names filed beneath an edited name, which stays current`);
  if (lines.length > 0) console.log("then: make bosses-export");
}

// Not awaited: main imports reconcile.mjs, which imports this module, and a top-level await here
// would leave this module unfinished while that import waits on it.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();

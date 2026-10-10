// A TrinityCore world DB + the client's map tables -> addons/Spoken_Books/Data/Places.lua.
//
// Where each readable is, for Azeroth's Compendium: those standing in the world (a plaque, a
// book on a shelf) in the zones their objects are spawned in, and those carried (a letter, a
// note) in the zones of what gives them -- a creature that drops one, a quest that hands it
// over, a chest, a vendor, a fishing pool -- with up to SOURCES of those named for the page.
// A readable given in more than WIDE zones (a rogue's pickpocketed letter, the Librams) is
// not listed under each: it is "found across Azeroth".
//
// And what each is (TYPE): a carried one by its item's icon (a letter's, a book's, a scroll's), one
// standing in the world by its name and how many pages it has (a gravestone, a museum's exhibit, a
// book on a shelf, else a plaque or a sign).
//
// The world DB is TrinityCore's schema, as the Forever repack ships it, not the vmangos dump
// extract.mjs reads: vmangos runs in Docker on the machine that has it, and this was written
// where the repack ran instead. Its own PLACES_MYSQL_* variables, so the two never mix up
// which database they read. Zones come from where each spawn stands, against the client's
// UiMapAssignment (wago.tools), because the server leaves its zone columns at 0. A dungeon is
// under the zone its entrance is in (INSTANCE_ZONE).
//
// Committed, as Books.lua is: the addon builds on a clone with no database.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

import { loadEnv } from "../../lib/env.mjs";
import { quote } from "./lib/lua.mjs";

await loadEnv("books");

const BOOKS = fileURLToPath(new URL("../../../addons/Spoken_Books/Data/Books.lua", import.meta.url));
const OUT = fileURLToPath(new URL("../../../addons/Spoken_Books/Data/Places.lua", import.meta.url));
const CACHE = fileURLToPath(new URL("./cache/", import.meta.url));
const BUILD = process.env.PLACES_BUILD ?? "1.15.9.69109";
const SOURCES = 6;
const WIDE = 8;
const LOCALES = ["deDE", "esES", "esMX", "frFR", "ptBR", "ruRU", "koKR", "zhCN", "zhTW", "itIT"];

// The dungeons and halls, under the zone their entrance is in.
const INSTANCE_ZONE = {
  33: 1421, // Shadowfang Keep: Silverpine Forest
  34: 1453, // The Stockade: Stormwind City
  36: 1436, // The Deadmines: Westfall
  43: 1413, // Wailing Caverns: The Barrens
  47: 1413, // Razorfen Kraul: The Barrens
  48: 1440, // Blackfathom Deeps: Ashenvale
  70: 1418, // Uldaman: Badlands
  90: 1426, // Gnomeregan: Dun Morogh
  109: 1435, // The Temple of Atal'Hakkar: Swamp of Sorrows
  129: 1413, // Razorfen Downs: The Barrens
  189: 1420, // Scarlet Monastery: Tirisfal Glades
  209: 1446, // Zul'Farrak: Tanaris
  229: 1427, // Blackrock Spire: Searing Gorge
  230: 1427, // Blackrock Depths: Searing Gorge
  249: 1445, // Onyxia's Lair: Dustwallow Marsh
  289: 1422, // Scholomance: Western Plaguelands
  309: 1434, // Zul'Gurub: Stranglethorn Vale
  329: 1423, // Stratholme: Eastern Plaguelands
  349: 1443, // Maraudon: Desolace
  389: 1454, // Ragefire Chasm: Orgrimmar
  409: 1427, // Molten Core: Searing Gorge
  429: 1444, // Dire Maul: Feralas
  449: 1453, // Champion's Hall: Stormwind City
  450: 1454, // Hall of Legends: Orgrimmar
  469: 1427, // Blackwing Lair: Searing Gorge
  509: 1451, // Ruins of Ahn'Qiraj: Silithus
  531: 1451, // Temple of Ahn'Qiraj: Silithus
  533: 1423, // Naxxramas: Eastern Plaguelands
};
// Text objects the server has and never spawns, placed by hand: the nameplates in Blackrock
// Depths' Dark Keeper vault.
const UNSPAWNED = { "Dark Keeper Nameplate": 230 };
// The order sources are listed in on a page: how the readable is had, most specific first.
const ORDER = ["quest start", "quest reward", "mail", "quest", "drop", "object", "container", "fishing", "vendor", "pickpocket"];

// ---------------------------------------------------------------- the client's tables

async function table(name) {
  const file = `${CACHE}${name}-${BUILD}.csv`;
  if (!existsSync(file)) {
    const response = await fetch(`https://wago.tools/db2/${name}/csv?build=${BUILD}`, {
      headers: { "User-Agent": "curl/8.0" },
    });
    if (!response.ok) throw new Error(`wago.tools ${name}: ${response.status}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, await response.text());
  }
  return parseCsv(await readFile(file, "utf8"));
}

// RFC 4180 as wago.tools writes it: quoted fields, doubled quotes inside them.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}

// ---------------------------------------------------------------- the readables

const booksLua = await readFile(BOOKS, "utf8");
const bookPart = booksLua.slice(booksLua.indexOf("\tbooks = {"));
const books = new Map();
for (const m of bookPart.matchAll(/\[(\d+)\] = \{ title = "((?:[^"\\]|\\.)*)", pages = \{ ([\d, ]+) \}/g)) {
  books.set(Number(m[1]), { title: m[2], pages: m[3].split(",").map(Number) });
}
const pageBook = new Map();
for (const [id, book] of books) for (const page of book.pages) pageBook.set(page, id);
if (books.size === 0) throw new Error(`no books read from ${BOOKS}`);

// ---------------------------------------------------------------- where on the map

const uiMap = new Map((await table("UiMap")).map((r) => [Number(r.ID), r]));
const assignments = (await table("UiMapAssignment")).filter((a) => uiMap.get(Number(a.UiMapID))?.Type === "3");
const areaZone = new Map();
for (const a of assignments) if (Number(a.AreaID) > 0 && !areaZone.has(Number(a.AreaID))) areaZone.set(Number(a.AreaID), Number(a.UiMapID));
// A subzone's area is under its zone's: ParentAreaID, up to one with a zone map.
const areaParent = new Map((await table("AreaTable")).map((r) => [Number(r.ID), Number(r.ParentAreaID)]));
function zoneOfArea(area) {
  for (let a = area, hops = 0; a > 0 && hops < 4; a = areaParent.get(a) ?? 0, hops++) {
    if (areaZone.has(a)) return areaZone.get(a);
  }
  return undefined;
}

function zoneAt(map, x, y) {
  if (INSTANCE_ZONE[map]) return INSTANCE_ZONE[map];
  let best;
  for (const a of assignments) {
    if (Number(a.MapID) !== map) continue;
    const [x0, y0, x1, y1] = [a.Region_0, a.Region_1, a.Region_3, a.Region_4].map(Number);
    if (x < Math.min(x0, x1) || x > Math.max(x0, x1) || y < Math.min(y0, y1) || y > Math.max(y0, y1)) continue;
    const size = Math.abs(x1 - x0) * Math.abs(y1 - y0);
    if (!best || size < best.size) best = { size, zone: Number(a.UiMapID) };
  }
  return best?.zone;
}

// ---------------------------------------------------------------- what each is

const iconPath = new Map((await table("ManifestInterfaceData")).map((r) => [Number(r.ID), (r.FilePath + r.FileName).toLowerCase()]));
const itemIcon = new Map((await table("Item")).map((r) => [Number(r.ID), iconPath.get(Number(r.IconFileDataID)) ?? ""]));

// In the order a carried one is tried: its icon first, then its name.
const ICON_TYPE = [
  [/inv_misc_book/, "book"], [/inv_letter/, "letter"], [/inv_misc_note|leatherscrap|bandage/, "note"],
  [/inv_scroll/, "scroll"], [/stonetablet|inv_misc_rune/, "tablet"],
];
const TITLE_TYPE = [
  [/letter|missive|envelope/i, "letter"], [/note|page|parchment|diary/i, "note"],
  [/book|tome|journal|manual|codex|libram|guide/i, "book"], [/scroll|orders|report|deed|writ|plans/i, "scroll"],
];
function typeOf(title, pages, world, items) {
  if (world) {
    if (/tombstone|headstone|here lies|in loving memory|\bgrave/i.test(title)) return "grave";
    if (/skeleton|\begg\b|talon|skull of|astrolabe|catapult|armor of|relics|reliefs/i.test(title)) return "exhibit";
    if (pages > 1 || /journal/i.test(title)) return "book";
    if (/\bnote\b/i.test(title)) return "note";
    return "plaque";
  }
  for (const item of items) {
    const icon = itemIcon.get(item) ?? "";
    for (const [pattern, type] of ICON_TYPE) if (pattern.test(icon)) return type;
  }
  for (const [pattern, type] of TITLE_TYPE) if (pattern.test(title)) return type;
  return "other";
}

// ---------------------------------------------------------------- the world DB

const db = await mysql.createConnection({
  host: process.env.PLACES_MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.PLACES_MYSQL_PORT ?? 3317),
  user: process.env.PLACES_MYSQL_USER ?? "root",
  password: process.env.PLACES_MYSQL_PASSWORD ?? "",
  database: process.env.PLACES_MYSQL_DATABASE ?? "world",
});
const q = async (sql, params = []) => (await db.query(sql, params))[0];
// An empty IN () is an error; -1 matches no id, where 0 would match every row left at 0.
const list = (xs) => [...new Set(xs)].length ? [...new Set(xs)] : [-1];

const sources = new Map(); // book -> Map(key -> { how, name: { enUS, ... }, zones: Set })
const bookItems = new Map(); // book -> [ item ids ]
const where = new Map();   // book -> Set of zones it stands in, for those in the world
const kind = new Map();    // book -> "world" | "carried"
function add(book, how, name, zones) {
  if (!sources.has(book)) sources.set(book, new Map());
  const key = `${how}|${name?.enUS ?? ""}`;
  const entry = sources.get(book).get(key) ?? { how, name, zones: new Set() };
  for (const z of zones) if (z) entry.zones.add(z);
  sources.get(book).set(key, entry);
}

async function names(tableName, idColumn, nameColumn, ids) {
  const out = new Map();
  if (!ids.length) return out;
  for (const r of await q(`SELECT ${idColumn} AS id, ${nameColumn} AS name FROM ${tableName.base} WHERE ${idColumn} IN (?)`, [list(ids)])) {
    out.set(Number(r.id), { enUS: r.name });
  }
  for (const r of await q(`SELECT ${tableName.localeId} AS id, locale, ${tableName.localeName} AS name FROM ${tableName.locale} WHERE ${tableName.localeId} IN (?)`, [list(ids)])) {
    if (r.name && out.has(Number(r.id)) && LOCALES.includes(r.locale)) out.get(Number(r.id))[r.locale] = r.name;
  }
  return out;
}
const CREATURE = { base: "creature_template", locale: "creature_template_locale", localeId: "entry", localeName: "Name" };
const OBJECT = { base: "gameobject_template", locale: "gameobject_template_locale", localeId: "entry", localeName: "name" };
const QUEST = { base: "quest_template", locale: "quest_template_locale", localeId: "ID", localeName: "LogTitle" };

async function spawnZones(spawnTable, ids) {
  const out = new Map();
  if (!ids.length) return out;
  for (const r of await q(`SELECT id, map, position_x AS x, position_y AS y FROM ${spawnTable} WHERE id IN (?)`, [list(ids)])) {
    const zone = zoneAt(Number(r.map), Number(r.x), Number(r.y));
    if (!zone) continue;
    if (!out.has(Number(r.id))) out.set(Number(r.id), new Set());
    out.get(Number(r.id)).add(zone);
  }
  return out;
}

try {
  // Standing in the world: text objects whose page is a readable's.
  const texts = (await q("SELECT entry, name, Data0 AS page FROM gameobject_template WHERE type = 9"))
    .filter((r) => pageBook.has(Number(r.page)));
  const textZones = await spawnZones("gameobject", texts.map((r) => Number(r.entry)));
  for (const r of texts) {
    const book = pageBook.get(Number(r.page));
    let zones = textZones.get(Number(r.entry));
    if (!zones && UNSPAWNED[r.name]) zones = new Set([INSTANCE_ZONE[UNSPAWNED[r.name]]]);
    if (!zones) continue;
    kind.set(book, "world");
    if (!where.has(book)) where.set(book, new Set());
    for (const z of zones) where.get(book).add(z);
  }

  // Carried: the items whose first page is a readable's.
  const itemBook = new Map();
  const itemName = new Map();
  for (const r of await table("ItemSparse")) {
    const page = Number(r.PageID || 0);
    if (pageBook.has(page)) {
      itemBook.set(Number(r.ID), pageBook.get(page));
      itemName.set(Number(r.ID), r.Display_lang);
      if (!bookItems.has(pageBook.get(page))) bookItems.set(pageBook.get(page), []);
      bookItems.get(pageBook.get(page)).push(Number(r.ID));
    }
  }
  for (const book of new Set(itemBook.values())) if (!kind.has(book)) kind.set(book, "carried");
  const items = [...itemBook.keys()];

  // Loot through references: a loot table's entry -> the readable items it can give.
  async function lootEntries(lootTable, wanted) {
    const direct = new Map();
    const put = (m, e, i) => { if (!m.has(e)) m.set(e, new Set()); for (const x of i) m.get(e).add(x); };
    for (const r of await q(`SELECT Entry, Item FROM ${lootTable} WHERE ItemType = 0 AND Item IN (?)`, [list(wanted)])) put(direct, Number(r.Entry), [Number(r.Item)]);
    const refs = new Map();
    for (const r of await q("SELECT Entry, Item FROM reference_loot_template WHERE ItemType = 0 AND Item IN (?)", [list(wanted)])) put(refs, Number(r.Entry), [Number(r.Item)]);
    for (let round = 0; round < 2; round++) {
      for (const r of await q("SELECT Entry, Item FROM reference_loot_template WHERE ItemType = 1 AND Item IN (?)", [list([...refs.keys()])])) {
        put(refs, Number(r.Entry), refs.get(Number(r.Item)) ?? []);
      }
    }
    for (const r of await q(`SELECT Entry, Item FROM ${lootTable} WHERE ItemType = 1 AND Item IN (?)`, [list([...refs.keys()])])) {
      put(direct, Number(r.Entry), refs.get(Number(r.Item)) ?? []);
    }
    return direct;
  }

  // Each readable item's sources, the containers' too, so a readable in a crate takes the
  // crate's: [{ how, name, zones }] by item.
  async function sourcesOf(wanted) {
    const out = new Map();
    const put = (item, how, name, zones) => {
      if (!out.has(item)) out.set(item, []);
      out.get(item).push({ how, name, zones: [...(zones ?? [])] });
    };
    // Creatures, killed or pickpocketed.
    for (const [column, how] of [["LootID", "drop"], ["PickPocketLootID", "pickpocket"]]) {
      const loot = await lootEntries(how === "drop" ? "creature_loot_template" : "pickpocketing_loot_template", wanted);
      const creatures = new Map();
      for (const r of await q(`SELECT Entry, ${column} AS loot FROM creature_template_difficulty WHERE DifficultyID = 0 AND ${column} IN (?)`, [list([...loot.keys()])])) {
        creatures.set(Number(r.Entry), loot.get(Number(r.loot)));
      }
      const named = await names(CREATURE, "entry", "name", [...creatures.keys()]);
      const zones = await spawnZones("creature", [...creatures.keys()]);
      for (const [c, its] of creatures) for (const i of its) put(i, how, named.get(c), zones.get(c));
    }
    // Chests and other objects that hold them.
    const gloot = await lootEntries("gameobject_loot_template", wanted);
    const chests = await q("SELECT entry, Data1 FROM gameobject_template WHERE type = 3 AND Data1 IN (?)", [list([...gloot.keys()])]);
    const chestNames = await names(OBJECT, "entry", "name", chests.map((r) => Number(r.entry)));
    const chestZones = await spawnZones("gameobject", chests.map((r) => Number(r.entry)));
    for (const r of chests) for (const i of gloot.get(Number(r.Data1))) put(i, "object", chestNames.get(Number(r.entry)), chestZones.get(Number(r.entry)));
    // Fishing: the loot table's entry is the area fished in.
    for (const r of await q("SELECT Entry, Item FROM fishing_loot_template WHERE Item IN (?)", [list(wanted)])) {
      put(Number(r.Item), "fishing", undefined, [zoneOfArea(Number(r.Entry))].filter(Boolean));
    }
    // Quests: given at the start, rewarded, dropped for one, or mailed after; where the quest is
    // picked up, else the zone it belongs to.
    const cols = ["StartItem", "RewardItem1", "RewardItem2", "RewardItem3", "RewardItem4",
      "RewardChoiceItemID1", "RewardChoiceItemID2", "RewardChoiceItemID3", "RewardChoiceItemID4", "RewardChoiceItemID5", "RewardChoiceItemID6",
      "ItemDrop1", "ItemDrop2", "ItemDrop3", "ItemDrop4"];
    const questItems = new Map();
    const want = new Set(wanted);
    const questRows = await q(`SELECT ID, QuestSortID, ${cols.join(", ")} FROM quest_template WHERE ${cols.map((c) => `${c} IN (?)`).join(" OR ")}`, cols.map(() => list(wanted)));
    const questSort = new Map();
    for (const r of questRows) {
      questSort.set(Number(r.ID), Number(r.QuestSortID));
      for (const c of cols) {
        if (!want.has(Number(r[c]))) continue;
        const how = c === "StartItem" ? "quest start" : c.startsWith("Reward") ? "quest reward" : "quest";
        if (!questItems.has(Number(r.ID))) questItems.set(Number(r.ID), []);
        questItems.get(Number(r.ID)).push([Number(r[c]), how]);
      }
    }
    const mail = new Map();
    for (const r of await q("SELECT Entry, Item FROM mail_loot_template WHERE Item IN (?)", [list(wanted)])) mail.set(Number(r.Entry), Number(r.Item));
    for (const r of await q("SELECT ID, RewardMailTemplateID AS t FROM quest_template_addon WHERE RewardMailTemplateID IN (?)", [list([...mail.keys()])])) {
      if (!questItems.has(Number(r.ID))) questItems.set(Number(r.ID), []);
      questItems.get(Number(r.ID)).push([mail.get(Number(r.t)), "mail"]);
    }
    const quests = [...questItems.keys()];
    for (const r of await q("SELECT ID, QuestSortID FROM quest_template WHERE ID IN (?)", [list(quests)])) questSort.set(Number(r.ID), Number(r.QuestSortID));
    const questNames = await names(QUEST, "ID", "LogTitle", quests);
    const givers = new Map();
    for (const [starter, spawn] of [["creature_queststarter", "creature"], ["gameobject_queststarter", "gameobject"]]) {
      const rows = await q(`SELECT id, quest FROM ${starter} WHERE quest IN (?)`, [list(quests)]);
      const zones = await spawnZones(spawn, rows.map((r) => Number(r.id)));
      for (const r of rows) {
        if (!givers.has(Number(r.quest))) givers.set(Number(r.quest), new Set());
        for (const z of zones.get(Number(r.id)) ?? []) givers.get(Number(r.quest)).add(z);
      }
    }
    for (const [quest, its] of questItems) {
      let zones = givers.get(quest);
      if (!zones?.size && questSort.get(quest) > 0) zones = [zoneOfArea(questSort.get(quest))].filter(Boolean);
      for (const [i, how] of its) put(i, how, questNames.get(quest), zones);
    }
    // Sold.
    const vendors = await q("SELECT entry, item FROM npc_vendor WHERE item IN (?)", [list(wanted)]);
    const vendorNames = await names(CREATURE, "entry", "name", vendors.map((r) => Number(r.entry)));
    const vendorZones = await spawnZones("creature", vendors.map((r) => Number(r.entry)));
    for (const r of vendors) put(Number(r.item), "vendor", vendorNames.get(Number(r.entry)), vendorZones.get(Number(r.entry)));
    return out;
  }

  const direct = await sourcesOf(items);
  // Inside another item: the container's sources, named after the container.
  const contained = await q("SELECT Entry, Item FROM item_loot_template WHERE Item IN (?)", [list(items)]);
  const containerNames = new Map();
  for (const r of await table("ItemSparse")) {
    if (contained.some((c) => Number(c.Entry) === Number(r.ID))) containerNames.set(Number(r.ID), r.Display_lang);
  }
  const viaContainer = await sourcesOf(contained.map((r) => Number(r.Entry)));
  for (const [item, list_] of direct) for (const s of list_) add(itemBook.get(item), s.how, s.name, s.zones);
  for (const r of contained) {
    const book = itemBook.get(Number(r.Item));
    const zones = new Set((viaContainer.get(Number(r.Entry)) ?? []).flatMap((s) => s.zones));
    add(book, "container", { enUS: containerNames.get(Number(r.Entry)) ?? `item ${r.Entry}` }, zones);
  }
} finally {
  await db.end();
}

// ---------------------------------------------------------------- the file

// Readables nobody can have: test items and the ones the game retired.
const gone = (title) => /^(Deprecated|TEST |Test )/.test(title) || /\(old\)$/.test(title);

const nameIndex = new Map();
const nameList = [];
function nameRef(name) {
  if (!name?.enUS) return null;
  const key = JSON.stringify(name);
  if (!nameIndex.has(key)) { nameList.push(name); nameIndex.set(key, nameList.length); }
  return nameIndex.get(key);
}

const lines = [];
const counts = { world: 0, carried: 0, wide: 0, nowhere: 0, gone: 0, types: {} };
for (const [id, book] of [...books].sort((a, b) => a[0] - b[0])) {
  if (gone(book.title)) { counts.gone++; continue; }
  const k = kind.get(id);
  if (!k) { counts.nowhere++; continue; }
  const list_ = [...(sources.get(id)?.values() ?? [])]
    .sort((a, b) => ORDER.indexOf(a.how) - ORDER.indexOf(b.how) || a.zones.size - b.zones.size || (a.name?.enUS ?? "").localeCompare(b.name?.enUS ?? ""));
  const zones = new Set(k === "world" ? where.get(id) : list_.flatMap((s) => [...s.zones]));
  const wide = zones.size > WIDE;
  counts[k]++;
  if (wide) counts.wide++;
  const type = typeOf(book.title, book.pages.length, k === "world", bookItems.get(id) ?? []);
  counts.types[type] = (counts.types[type] ?? 0) + 1;
  const parts = [`kind = "${k}"`, `type = "${type}"`];
  if (wide) parts.push("wide = true");
  else if (zones.size) parts.push(`zones = { ${[...zones].sort((a, b) => a - b).join(", ")} }`);
  if (k === "carried" && list_.length) {
    const from = list_.slice(0, SOURCES).map((s) => {
      const ref = nameRef(s.name);
      const z = [...s.zones].sort((a, b) => a - b).slice(0, 3);
      return `{ "${s.how}", ${ref ?? "false"}${z.length ? ", " + z.join(", ") : ""} }`;
    });
    parts.push(`from = { ${from.join(", ")} }`);
  }
  lines.push(`\t\t[${id}] = { ${parts.join(", ")} },`);
}

const nameLines = nameList.map((n, i) => {
  const locs = LOCALES.filter((l) => n[l] && n[l] !== n.enUS).map((l) => `${l} = ${quote(n[l])}`);
  return `\t\t[${i + 1}] = { ${[quote(n.enUS), ...locs].join(", ")} },`;
});

const out = `-- AUTO-GENERATED by pipelines/books/tools/places.mjs. Do not edit by hand.
--
-- Where each readable is, for Azeroth's Compendium: "world" ones stand in the zones listed (a
-- plaque, a book on a shelf); "carried" ones are had in them (a letter dropped, a note handed
-- over). \`type\` is what it is: book, letter, note, scroll, tablet, plaque, grave, exhibit or
-- other. \`from\` names how a carried one is had, most specific first: { how, name, zone... }, the name an index
-- into \`names\` (false where there is none, as for fishing). \`wide\` is a readable had in too many
-- zones to list under each. Zones are uiMapIDs. Regenerate with:  make books-places
--
-- A global rather than a private namespace, as Books.lua is: a data file cannot reach into the
-- addon's environment.

SpokenBooksPlaces = {
\tversion = 1,

\tbooks = {
${lines.join("\n")}
\t},

\tnames = {
${nameLines.join("\n")}
\t},
}
`;
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, out);
console.log(`${counts.world} in the world, ${counts.carried} carried (${counts.wide} across Azeroth), ` +
  `${counts.nowhere} with no place, ${counts.gone} that cannot be had; ${nameList.length} names`);
console.log(Object.entries(counts.types).map(([t, n]) => `${n} ${t}`).join(", "));
console.log(`wrote ${OUT}`);

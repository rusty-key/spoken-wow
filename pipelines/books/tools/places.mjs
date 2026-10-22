// A TrinityCore world DB + the client's map tables -> addons/Spoken_Readables/Data/Places.lua.
//
// Where each readable is, for Azeroth's Compendium: those standing in the world (a plaque, a
// book on a shelf) in the zones their objects are spawned in, and those carried (a letter, a
// note) in the zones of what gives them -- a creature that drops one, a quest that hands it
// over, a chest, a vendor, a fishing pool -- with up to SOURCES of those named for the page.
// A readable given in more than WIDE zones (a rogue's pickpocketed letter, the Librams) is
// not listed under each: it is "found across Azeroth".
//
// And what each is (typeOf, in lib/places.mjs): a book, a journal, a letter, a gravestone, a
// picture with no words, by its title, its words and its item's icon.
//
// The world DB is TrinityCore's schema, as the Forever repack ships it, not the vmangos dump
// extract.mjs reads: vmangos runs in Docker on the machine that has it, and this was written
// where the repack ran instead. Its own PLACES_MYSQL_* variables, so the two never mix up
// which database they read. Zones come from where each spawn stands: the area the server's own
// map files put the point in (PLACES_MAPS), up to its zone through the client's AreaTable and
// UiMapAssignment (wago.tools), because the server leaves its zone columns at 0. A dungeon is
// under the zone its entrance is in (INSTANCE_ZONE, pipelines/lib/dungeons.json), and a readable
// had there only from inside a dungeon or raid names it (`dungeons`), so the Compendium files it
// under the dungeon's card as the Quests tab files that dungeon's quests, by the same maps
// (Spoken's Data/Dungeons.lua names them).
//
// Committed, as Books.lua is: the addon builds on a clone with no database.

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

import { instanceZones, loadDungeons } from "../../lib/dungeons.mjs";
import { loadEnv } from "../../lib/env.mjs";
import { FOREVER_BUILD, wagoTable } from "../../lib/wago.mjs";
import { areaReader } from "./lib/area.mjs";
import { cannotBeHad, dungeonsOf, isTemplateCopy, typeOf } from "./lib/places.mjs";

await loadEnv("books");

const BOOKS = fileURLToPath(new URL("../../../addons/Spoken_Readables/Data/Books.lua", import.meta.url));
const OUT = fileURLToPath(new URL("../../../addons/Spoken_Readables/Data/Places.lua", import.meta.url));
// Forever's client, not Era's: Era's 1.15.9 also carries Season of Discovery and anniversary
// items, and one that shares a vanilla page id lent that book its sources and zones.
const BUILD = process.env.PLACES_BUILD ?? FOREVER_BUILD;
const MAPS = process.env.PLACES_MAPS ?? "C:/Forever/ForeverRepack/data/maps";
const WIDE = 8;

// The dungeons, halls and battlegrounds, under the zone their entrance is in. The battlegrounds are
// zones of their own: Forever's client files them as orphan maps, not zones, so nothing else would
// place Alterac Valley's Rock of Durotan. Only the dungeons and raids are a readable's `dungeons`;
// another instance (a battleground, a PvP hall) stays its zone's.
const INSTANCE_ZONE = instanceZones();
// A map under `instances` too (the Excavation Site) is its zone's, as the quests' exporter files it.
const { dungeons: ALL_DUNGEONS, instances: NOT_DUNGEONS } = loadDungeons();
const DUNGEONS = Object.fromEntries(Object.entries(ALL_DUNGEONS).filter(([map]) => !NOT_DUNGEONS[map]));
// A spawn inside a dungeon is placed at -map until the file is written, so a readable's zones
// still say which of them it is had in only from inside one.
const placeOf = (z) => (z < 0 ? INSTANCE_ZONE[-z] : z);
// Text objects the server has and never spawns, placed by hand: the nameplates in Blackrock
// Depths' Dark Keeper vault.
const UNSPAWNED = { "Dark Keeper Nameplate": 230 };
// Sources the world DB cannot see, by book id: an item a spell or a machine makes, a quest whose
// giver it does not spawn. Each names a quest or an object, checked against the world DB, and
// the zones, where the object's spawns do not give them.
const SOURCES_BY_HAND = {
  394: [{ how: "quest", quest: 1016, zones: [1440] }], // Divined Scroll: the Divining Scroll, used in Ashenvale
  1171: [{ how: "quest", quest: 2944, zones: [1425] }], // Snapshot of Gammerita: taken in the Hinterlands
  // Gnomeregan's punch cards, each made from the one before at a Matrix Punchograph.
  1191: [{ how: "object", object: 142345 }], // 3005-A
  1192: [{ how: "object", object: 142475 }], // 3005-B
  1193: [{ how: "object", object: 142476 }], // 3005-C
  1194: [{ how: "object", object: 142696 }], // 3005-D
  2671: [{ how: "quest start", quest: 7636, zones: [1448] }], // Petrified Bark: Vartrus the Ancient, Felwood
  2859: [{ how: "quest reward", quest: 8996, zones: [1427] }], // Brazier of Invocation: Bodley, Blackrock Mountain
};
// The seasonal events' readables, had only while the event runs, by event: the Compendium lists
// them under Holidays and Events, a line for each event. Their NPCs are spawned by the event, and
// most have no spawn in the DB.
const EVENTS = new Map([
  [2571, "winterveil"], [2841, "winterveil"], // The Feast of Winter Veil, Metzen's Letters and Notes
  [2787, "harvestfestival"], [2790, "harvestfestival"], // the poems for Uther and Grom
  [2786, "fishingextravaganza"], // Stranglethorn's flier
  // Scourge Invasion: the Call to Arms, the soldiers' letters by the Necrotic Shards, and the
  // reports the Keeper of the Rolls mails back for them.
  ...[2872, 2878, 2880, 2881, 2882, 2883, 2884, 2885, 2886, 2887, 2888, 2889, 2890].map((id) => [id, "scourgeinvasion"]),
]);
// Readables nothing in the DB places, placed by hand where the wiki has them.
const ZONES_BY_HAND = {
  124: [1434], // Green Hills of Stranglethorn: the cover of Hemet Nesingwary's book, whose pages are found in Stranglethorn Vale
};
// Types no title, icon or first page gives away, by book id: read off the words or the wiki.
const TYPE_BY_HAND = {
  15: "letter", // William's Shipment: "Hello Morgan, ..."
  29: "note", // Crate of Horseshoes: "A note is attached to the crate."
  58: "tablet", 62: "tablet", 285: "tablet", 324: "tablet", // the Troll Legends, from stone tablets
  73: "journal", // Book from Sven's Farm: Stalvan's diary
  153: "book", 161: "book", 169: "book", 177: "book", // Green Hills chapters, bound
  336: "letter", // Cloth Request: "To the Schneiders, ..."
  439: "letter", // Kravel's Scheme: "Mr. Fizzlebub, the bearer of this letter..."
  711: "letter", // Neeka's Report: "Helgrum, my compliments..."
  794: "book", // Lorgalis Manuscript: a four-page history
  1392: "letter", // Grape Manifest: "Brother Neals, ..."
  1591: "plaque", // Etched Note: a sign on Jordan Stilwell's anvil
  2271: "letter", // Cliffwatcher Longhorn Report: "Nataka, ..."
  2514: "note", // Brock's List: a list of students
  2807: "journal", // Decoded Tablet Transcription: a diary, "Day 1..."
  2838: "letter", // From the Desk of Lord Victor Nefarius: "To Whom It May Concern, ..."
  // The soldiers' letters from the Scourge invasion, and the reports the Keeper of the Rolls
  // mails back for them.
  2882: "letter", 2883: "letter", 2884: "letter",
  2885: "letter", 2886: "letter", 2887: "letter", 2888: "letter", 2889: "letter", 2890: "letter",
};

// ---------------------------------------------------------------- the client's tables

function table(name) {
  return wagoTable(name, { build: BUILD });
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
// Each page's words, as Lua source: what a gravestone says decides that it is one.
const pageText = new Map();
const pagePart = booksLua.slice(booksLua.indexOf("\tpages = {"), booksLua.indexOf("\tbooks = {"));
for (const m of pagePart.matchAll(/\[(\d+)\] = \{ book = \d+, number = \d+, text = "((?:[^"\\]|\\.)*)"/g)) {
  pageText.set(Number(m[1]), m[2]);
}

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

// The cities, each inside the zone around it. Ironforge and the Undercity are buildings set into
// the ground, and the map files give a point inside them the ground's area, Dun Morogh's or
// Tirisfal's; there the rectangle, which says city, is kept.
const CITY_IN = { 1453: 1429, 1454: 1411, 1455: 1426, 1456: 1412, 1457: 1438, 1458: 1420 };
const areaAt = areaReader(MAPS);

function zoneAt(map, x, y) {
  if (INSTANCE_ZONE[map]) return DUNGEONS[map] ? -map : INSTANCE_ZONE[map];
  const box = boxAt(map, x, y);
  const area = areaAt(map, x, y);
  const zone = area && zoneOfArea(area);
  if (!zone || CITY_IN[box] === zone) return box;
  return zone;
}

// The smallest zone rectangle the point is in: where the map files have no answer, and the city
// test above.
function boxAt(map, x, y) {
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

// ---------------------------------------------------------------- what each is (lib/places.mjs)

const iconPath = new Map((await table("ManifestInterfaceData")).map((r) => [Number(r.ID), (r.FilePath + r.FileName).toLowerCase()]));
const itemIcon = new Map((await table("Item")).map((r) => [Number(r.ID), iconPath.get(Number(r.IconFileDataID)) ?? ""]));

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

const sources = new Map(); // book -> Set of zones it is had in, for those carried
const bookItems = new Map(); // book -> [ item ids ]
const where = new Map();   // book -> Set of zones it stands in, for those in the world
const kind = new Map();    // book -> "world" | "carried"
function add(book, zones) {
  if (!sources.has(book)) sources.set(book, new Set());
  for (const z of zones) if (z) sources.get(book).add(z);
}

async function names(tableName, idColumn, nameColumn, ids) {
  const out = new Map();
  if (!ids.length) return out;
  for (const r of await q(`SELECT ${idColumn} AS id, ${nameColumn} AS name FROM ${tableName} WHERE ${idColumn} IN (?)`, [list(ids)])) {
    out.set(Number(r.id), { enUS: r.name });
  }
  return out;
}
const CREATURE = "creature_template";
const OBJECT = "gameobject_template";
const QUEST = "quest_template";

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
    if (!zones && UNSPAWNED[r.name]) zones = new Set([-UNSPAWNED[r.name]]);
    if (!zones) continue;
    kind.set(book, "world");
    if (!where.has(book)) where.set(book, new Set());
    for (const z of zones) where.get(book).add(z);
  }

  // Carried: the items whose first page is a readable's.
  const itemBook = new Map();
  for (const r of await table("ItemSparse")) {
    const page = Number(r.PageID || 0);
    if (pageBook.has(page)) {
      itemBook.set(Number(r.ID), pageBook.get(page));
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
      for (const [c, its] of creatures) {
        if (isTemplateCopy(named.get(c)?.enUS)) continue;
        for (const i of its) put(i, how, named.get(c), zones.get(c));
      }
    }
    // Chests and other objects that hold them.
    const gloot = await lootEntries("gameobject_loot_template", wanted);
    const chests = await q("SELECT entry, Data1 FROM gameobject_template WHERE type = 3 AND Data1 IN (?)", [list([...gloot.keys()])]);
    const chestZones = await spawnZones("gameobject", chests.map((r) => Number(r.entry)));
    for (const r of chests) for (const i of gloot.get(Number(r.Data1))) put(i, "object", undefined, chestZones.get(Number(r.entry)));
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
      for (const [i, how] of its) put(i, how, undefined, zones);
    }
    // Sold.
    const vendors = await q("SELECT entry, item FROM npc_vendor WHERE item IN (?)", [list(wanted)]);
    const vendorNames = await names(CREATURE, "entry", "name", vendors.map((r) => Number(r.entry)));
    const vendorZones = await spawnZones("creature", vendors.map((r) => Number(r.entry)));
    for (const r of vendors) {
      if (isTemplateCopy(vendorNames.get(Number(r.entry))?.enUS)) continue;
      put(Number(r.item), "vendor", vendorNames.get(Number(r.entry)), vendorZones.get(Number(r.entry)));
    }
    return out;
  }

  const direct = await sourcesOf(items);
  // Inside another item: the container's sources.
  const contained = await q("SELECT Entry, Item FROM item_loot_template WHERE Item IN (?)", [list(items)]);
  const viaContainer = await sourcesOf(contained.map((r) => Number(r.Entry)));
  for (const [item, list_] of direct) for (const s of list_) add(itemBook.get(item), s.zones);
  for (const r of contained) {
    const book = itemBook.get(Number(r.Item));
    const zones = new Set((viaContainer.get(Number(r.Entry)) ?? []).flatMap((s) => s.zones));
    add(book, zones);
  }

  // And what the DB cannot see. A hand source that matches one the DB found gives it its zones.
  const hand = Object.values(SOURCES_BY_HAND).flat();
  const handQuests = await names(QUEST, "ID", "LogTitle", hand.filter((s) => s.quest).map((s) => s.quest));
  const handObjects = await names(OBJECT, "entry", "name", hand.filter((s) => s.object).map((s) => s.object));
  const handObjectZones = await spawnZones("gameobject", hand.filter((s) => s.object).map((s) => s.object));
  for (const [book, list_] of Object.entries(SOURCES_BY_HAND)) {
    for (const s of list_) {
      const name = s.quest ? handQuests.get(s.quest) : handObjects.get(s.object);
      if (!name) throw new Error(`book ${book}: no ${s.quest ? `quest ${s.quest}` : `object ${s.object}`} in the world DB`);
      add(Number(book), s.zones ?? handObjectZones.get(s.object) ?? []);
    }
    if (!kind.has(Number(book))) kind.set(Number(book), "carried");
  }
} finally {
  await db.end();
}

// ---------------------------------------------------------------- the file

const gone = (id, book) => cannotBeHad(book.title, book.pages.map((page) => pageText.get(page) ?? ""), id);

const lines = [];
const counts = { world: 0, carried: 0, wide: 0, event: 0, nowhere: 0, gone: 0, types: {}, inDungeon: 0, dungeons: new Map() };
for (const [id, book] of [...books].sort((a, b) => a[0] - b[0])) {
  if (gone(id, book)) { counts.gone++; continue; }
  const k = kind.get(id);
  if (!k) { counts.nowhere++; continue; }
  const spots = new Set(k === "world" ? where.get(id) : sources.get(id));
  if (!spots.size) for (const zone of ZONES_BY_HAND[id] ?? []) spots.add(zone);
  const zones = new Set([...spots].map(placeOf));
  const dungeons = dungeonsOf(spots, INSTANCE_ZONE);
  const wide = zones.size > WIDE;
  counts[k]++;
  if (wide) counts.wide++;
  const type = TYPE_BY_HAND[id] ?? typeOf({ title: book.title, world: k === "world", texts: book.pages.map((page) => pageText.get(page) ?? ""),
    icons: (bookItems.get(id) ?? []).map((item) => itemIcon.get(item) ?? "") });
  counts.types[type] = (counts.types[type] ?? 0) + 1;
  const parts = [`kind = "${k}"`, `type = "${type}"`];
  if (EVENTS.has(id)) { parts.push(`event = "${EVENTS.get(id)}"`); counts.event++; }
  if (wide) parts.push("wide = true");
  else if (zones.size) {
    parts.push(`zones = { ${[...zones].sort((a, b) => a - b).join(", ")} }`);
    if (dungeons.length) {
      parts.push(`dungeons = { ${dungeons.join(", ")} }`);
      counts.inDungeon++;
      for (const d of dungeons) counts.dungeons.set(d, (counts.dungeons.get(d) ?? 0) + 1);
    }
  }
  lines.push(`\t\t[${id}] = { ${parts.join(", ")} },`);
}

const out = `-- AUTO-GENERATED by pipelines/books/tools/places.mjs. Do not edit by hand.
--
-- Where each readable is, for Azeroth's Compendium: "world" ones stand in the zones listed (a
-- plaque, a book on a shelf); "carried" ones are had in them (a letter dropped, a note handed
-- over). \`type\` is what it is: book, journal, letter, note, scroll, tablet, plaque, grave,
-- exhibit, picture or other. \`wide\` is a readable had in too many zones to list under each.
-- \`event\` is the seasonal event one is had only during, listed under Holidays and Events, a line
-- for each event, rather than its zones. Zones are uiMapIDs.
-- \`dungeons\` are the instance maps of the dungeons and raids a readable is had in from inside
-- alone, in a zone it is had nowhere else in; Spoken's Data/Dungeons.lua names each, with the zone
-- its entrance is in. Regenerate with:  make books-places
--
-- A global rather than a private namespace, as Books.lua is: a data file cannot reach into the
-- addon's environment.

SpokenBooksPlaces = {
\tversion = 1,

\tbooks = {
${lines.join("\n")}
\t},
}
`;
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, out);
console.log(`${counts.world} in the world, ${counts.carried} carried (${counts.wide} across Azeroth, ${counts.event} at events), ` +
  `${counts.nowhere} with no place, ${counts.gone} that cannot be had`);
console.log(`${counts.inDungeon} in dungeons: ` + [...counts.dungeons].sort((a, b) => a[0] - b[0])
  .map(([d, n]) => `${n} in ${DUNGEONS[d].name}`).join(", "));
console.log(Object.entries(counts.types).map(([t, n]) => `${n} ${t}`).join(", "));
console.log(`wrote ${OUT}`);

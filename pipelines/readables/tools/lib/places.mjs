// The rules places.mjs applies to what it reads, kept apart from the database so they can be
// tested.

// A creature template that copies another for a difficulty or a test, as Alterac Valley's
// "Alliance Sentinel (1)" and "Commander Dardosh <old> (1)" do. Named as a source, it showed on a
// page as "Dropped by Alliance Sentinel (1)".
export function isTemplateCopy(name) {
  return / \(\d+\)$/.test(name ?? "") || /<old>/i.test(name ?? "");
}

// Readables with words that no one can have: the Forsaken class letters that were never given out
// (the Musty Note, Parchment, Scroll, Letter and Missive). No loot, quest, vendor or mail names
// their items.
export const NEVER_HAD = new Set([691, 692, 693, 694, 695]);

// A readable nobody can have, which would keep every "found X of Y" out of reach: one of
// NEVER_HAD (by book id), a test item, one the game retired, or one whose every page is the
// server's "Missing Text", left where a beta item's words were never written. Books.lua, Places.lua
// and the sound pack all leave these out.
export function cannotBeHad(title, texts = [], bookId = null) {
  if (NEVER_HAD.has(bookId)) return true;
  if (/^(Deprecated|TEST |Test )/.test(title) || /\(old\)$/.test(title)) return true;
  return texts.length > 0 && texts.every((text) => text.trim() === "Missing Text");
}

// A title that names its own form says what it is better than its item's icon does: the game
// gave "Maybell's Love Letter" a scroll's icon and "Crystallized Note" a tablet's.
const FORM_TYPE = [
  [/journal|diary/i, "journal"], [/letter|missive|envelope/i, "letter"],
  [/\bnote\b|parchment/i, "note"], [/scroll/i, "scroll"], [/tablet/i, "tablet"],
];
// Then the icon, then the rest of the title.
const ICON_TYPE = [
  [/inv_misc_book/, "book"], [/inv_letter/, "letter"], [/inv_misc_note|leatherscrap|bandage/, "note"],
  [/inv_scroll/, "scroll"], [/stonetablet|inv_misc_rune/, "tablet"],
];
const TITLE_TYPE = [
  [/page/i, "note"], [/book|tome|manual|codex|libram|guide/i, "book"],
  [/orders|report|deed|writ|plans/i, "scroll"],
];

// What a readable is, from its title, its pages' words (`texts`, first page first) and its items'
// icons. One with no words on any page is a picture or a map: the game draws it, as the Snapshot of
// Gammerita and the Crude Map. One standing in the world by its name, its first page and how many
// pages it has (a gravestone, a museum's exhibit, a book on a shelf, else a plaque or a sign); a
// carried one by the form its title names, else its item's icon, else the rest of its title.
//
// A grave is known by its words too: Uther's, Durotan's and Grom's markers carry their names, not
// "Tombstone", and open "Here lies". "In memory of" is left out: Horatio Montgomery's plaque in
// Stormwind is a memorial, not a grave.
export function typeOf({ title, world = false, texts = [], icons = [] }) {
  if (texts.length && texts.every((text) => text.trim() === "")) return "picture";
  if (world) {
    if (/tombstone|headstone|here lies|in loving memory|\bgrave/i.test(title)) return "grave";
    if (/^\s*(here lies|in loving memory)/i.test(texts[0] ?? "")) return "grave";
    if (/skeleton|\begg\b|talon|skull of|astrolabe|catapult|armor of|relics|reliefs|strider/i.test(title)) return "exhibit";
    if (/journal|diary/i.test(title)) return "journal";
    if (texts.length > 1) return "book";
    if (/\bnote\b/i.test(title)) return "note";
    return "plaque";
  }
  for (const [pattern, type] of FORM_TYPE) if (pattern.test(title)) return type;
  for (const icon of icons) {
    for (const [pattern, type] of ICON_TYPE) if (pattern.test(icon)) return type;
  }
  for (const [pattern, type] of TITLE_TYPE) if (pattern.test(title)) return type;
  return "other";
}

// The dungeons and raids a readable is had in from inside alone, by map: `spots` are where it is
// had, a uiMapID for a zone and -map for a spawn inside a dungeon, and `entrance` gives each
// dungeon's map the zone its entrance is in. A zone it is also had in outside keeps it in the zone:
// the Bloodstained Journal, dropped in Uldaman and in the Badlands around it, is the Badlands'.
export function dungeonsOf(spots, entrance) {
  const inZone = new Map();
  for (const spot of spots) {
    const zone = spot < 0 ? entrance[-spot] : spot;
    if (!inZone.has(zone)) inZone.set(zone, new Set());
    inZone.get(zone).add(spot < 0 ? -spot : 0);
  }
  const out = [];
  for (const maps of inZone.values()) if (!maps.has(0)) out.push(...maps);
  return out.sort((a, b) => a - b);
}

// The quests Forever has: one the corpus voices or the client's QuestV2 lists. The repack's
// quest_template also carries Cataclysm's rows (24900-29021), whose items gave readables zones
// Forever never hands them out in. QuestV2 alone will not do: it lacks hundreds of quests the corpus
// shows live, Stormwind Library (579) and the Fishing Flier's (8228, 8229) among them.
export function foreverQuests(corpusLines, questV2) {
  return new Set([...corpusLines.map((line) => Number(line.questId)), ...questV2.map((row) => Number(row.ID))].filter(Boolean));
}

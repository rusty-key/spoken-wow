// What each zone and subzone is called in a language, from the client's own tables.
//
// Not read back out of Data/<locale>/Aliases.lua, which is what this used to do. That table
// is built for the addon's lookup and is right for it, but it leaves out two kinds of name
// the site needs: zones (the addon never looks a zone up by name, so it only carried the few
// that share a name with a subzone) and names that are the same in both languages (a Latin
// client normalises its way to those without help). Read as a list of translations, both
// came out as untranslated, so Mulgore sat in the Spanish explorer as English when it is
// simply Mulgore in Spanish too.
//
// A zone is named from UiMap, by the uiMapID its line is stored under, and a subzone from
// AreaTable, by its English key. UiMap is what the world map titles itself with, and the
// only one of the two that has the continents: Kalimdor and Eastern Kingdoms are maps, not
// areas, and AreaTable has no row for them.

import { normaliseKey } from "./wiki.mjs";

/**
 * English key -> localised name, for the subzone keys asked for.
 *
 * AreaTable carries both names against one ID, so this is a join. Several rows can share an
 * English name (a zone and its like-named area, an instance entrance); the first localised
 * name wins, as it does in the alias tables.
 *
 * @param english AreaTable rows in English: { ID, AreaName_lang }
 * @param localised the same table in the language
 * @param wanted the keys worth keeping -- the corpus's
 */
export function areaNames(english, localised, wanted) {
  const englishById = new Map(english.map((row) => [row.ID, (row.AreaName_lang || "").trim()]));
  const names = new Map();
  for (const row of localised) {
    const name = (row.AreaName_lang || "").trim();
    const englishName = englishById.get(row.ID);
    if (!name || !englishName) continue;
    const key = normaliseKey(englishName);
    if (wanted.has(key) && !names.has(key)) names.set(key, name);
  }
  return names;
}

/**
 * uiMapID -> localised name, for the maps asked for.
 *
 * @param localised UiMap rows in the language: { ID, Name_lang }
 * @param wanted the corpus's uiMapIDs
 */
export function mapNames(localised, wanted) {
  const names = new Map();
  for (const row of localised) {
    const name = (row.Name_lang || "").trim();
    const mapID = Number(row.ID);
    if (name && wanted.has(mapID)) names.set(mapID, name);
  }
  return names;
}

/**
 * entity_name rows for the lore lines a language names.
 *
 * A zone is matched on its uiMapID and a subzone on its key. Where one key names subzones
 * in several zones, each of them gets it: it is the same place name.
 *
 * @param lines English lore_line rows: { lineId, kind, mapID, key }
 * @param names one language's entry in the seed: { zones: {mapID: name}, subzones: {key: name} }
 */
export function namesForLines(lines, names) {
  const out = [];
  for (const line of lines) {
    const name = line.kind === "zone" ? names.zones[line.mapID] : names.subzones[line.key];
    if (name) out.push({ kind: line.kind, entityId: line.lineId, name });
  }
  return out;
}

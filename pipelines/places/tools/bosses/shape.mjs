// The boss tables' rows, shaped for the three renderers. Retired bosses never reach a file.

import { LOCALES } from "../../../lib/dungeons.mjs";

const live = (bosses) => bosses.filter((b) => !b.retired);

/**
 * `bosses` as readBosses gives them, `names` as readNames('boss'): render()'s input. A locale's
 * name is passed only where the boss has one; render drops those equal to English.
 */
export function bossesForExport(bosses, names) {
  const maps = {};
  const byLocale = Object.fromEntries(LOCALES.map((locale) => [locale, {}]));
  for (const b of live(bosses)) {
    const langs = names.get(String(b.id)); // entity_name keys entities as text
    const name = langs?.get("enUS");
    if (!name) throw new Error(`boss ${b.id} (${b.key}) has no English name`);
    (maps[b.map] ??= []).push({ id: b.id, ids: b.encounterIds, key: b.key, name });
    for (const locale of LOCALES) if (langs.has(locale)) byLocale[locale][b.id] = langs.get(locale);
  }
  return { maps, names: byLocale };
}

/** renderCreatures's rows. */
export function creaturesForExport(bosses) {
  return live(bosses).map((b) => ({ map: b.map, key: b.key, creature: b.creatureId, display: b.displayId }));
}

/**
 * renderStories's input, { map: { key: story } }: a string where the boss has only English, else
 * { 1: English, [locale]: text } with every language that has a current row, English or not.
 */
export function storiesForExport(bosses, stories) {
  const out = {};
  for (const b of live(bosses)) {
    const langs = stories.get(b.id);
    if (!langs || langs.size === 0) continue;
    const en = langs.get("enUS")?.text;
    const others = LOCALES.filter((locale) => langs.has(locale));
    const entry = others.length === 0 ? en : {};
    if (others.length > 0) {
      if (en !== undefined) entry[1] = en;
      for (const locale of others) entry[locale] = langs.get(locale).text;
    }
    if (entry === undefined) continue;
    (out[b.map] ??= {})[b.key] = entry;
  }
  return out;
}

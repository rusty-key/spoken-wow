// The set of area names a supported client can actually report.
//
// Loaded from tools/seed/era-areas.json, a committed dump of the client's own
// AreaTable (see fetch-era-areas.mjs for provenance). Corpus keys are normalised
// area names, so the set is normalised the same way here and membership is the
// whole test: a key outside it belongs to a place the Era client does not have,
// and no scrape, export or voice line should be spent on it.

import { join } from "node:path";

import { ROOT, normaliseKey, readJson } from "./wiki.mjs";

const SEED = join(ROOT, "pipelines/zones/tools/seed/era-areas.json");
const CAMELOT_SEED = join(ROOT, "pipelines/zones/tools/seed/camelot-areas.json");

/** @returns {Promise<{build: string, keys: Set<string>}>} */
export async function loadEraAreas() {
  const seed = await readJson(SEED);
  return { build: seed.build, keys: new Set(seed.names.map(normaliseKey)) };
}

/**
 * Era and Camelot together, which is what the corpus filter wants.
 *
 * The addon ships for both clients, so a place either one can name is a place worth
 * having a line for; filtering on Era alone dropped every subzone this build added.
 * Callers that mean Era specifically -- retiring a line, checking what Era can say --
 * still want loadEraAreas above, so this is a second function rather than a wider one.
 *
 * @returns {Promise<{builds: string[], keys: Set<string>}>}
 */
export async function loadClientAreas() {
  const [era, camelot] = await Promise.all([readJson(SEED), readJson(CAMELOT_SEED)]);
  const keys = new Set();
  for (const name of [...era.names, ...camelot.names]) keys.add(normaliseKey(name));
  return { builds: [era.build, camelot.build], keys };
}

/**
 * Key -> the name the client shows for that area, Forever's spelling first, then Era's. The lore's
 * names are wiki titles, which drop the client's leading "The" (The Crossroads). A key that one
 * client spells two ways is left out, so the lore keeps its own name there.
 *
 * @param {string[]} foreverNames
 * @param {string[]} eraNames
 * @returns {Map<string, string>}
 */
export function clientNames(foreverNames, eraNames) {
  const names = new Map();
  const seen = new Set();
  for (const list of [foreverNames, eraNames]) {
    const byKey = new Map();
    for (const raw of list) {
      const name = raw.trim();
      const key = normaliseKey(name);
      if (!key || seen.has(key)) continue;
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key).add(name);
    }
    for (const [key, spellings] of byKey) {
      seen.add(key);
      if (spellings.size === 1) names.set(key, [...spellings][0]);
    }
  }
  return names;
}

/** clientNames over the two committed seeds. */
export async function loadClientNames() {
  const [era, camelot] = await Promise.all([readJson(SEED), readJson(CAMELOT_SEED)]);
  return clientNames(camelot.names, era.names);
}

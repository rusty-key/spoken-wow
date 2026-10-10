/**
 * The values the filter dropdowns can offer.
 *
 * The roster in lib/voices/voices.ts, so a voice added there is filterable before any line
 * uses it, and the filters, /voices and the triage selects always offer the same set. Zones
 * come from the committed zone-regions seed, so a zone with no line yet is still offered.
 *
 * Being closed sets also makes them a whitelist, which is what lets /api/search take these
 * straight from a query string.
 *
 * `source` and `npcType` are absent on purpose: they are closed unions on CorpusLine, so
 * their lists live next to the type in lib/search.ts.
 */
import { QUEST_ZONES, type QuestZone } from "./quests/zones";
import { flavorScopes, GENDERS, RACES, VOICE_NAMES, VOICES } from "./voices/voices";

export type Facets = {
  races: string[];
  genders: string[];
  flavors: string[];
  voices: string[];
  /**
   * Every race/gender/flavor the roster pairs.
   *
   * A flavor belongs to a race-gender - only tauren, troll and orc have a shaman voice, and
   * only night elves a priestess - so offering all fifty against a chosen race would mostly
   * offer ways to select nothing. Carried as triples rather than a map keyed by race-gender
   * so a partial selection (a race with no gender) narrows by the same filter.
   */
  flavorScopes: { race: string; gender: string; flavor: string }[];
  zones: QuestZone[];
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

const FACETS: Facets = {
  races: [...RACES],
  genders: [...GENDERS],
  flavors: sorted(VOICES.flatMap((voice) => (voice.flavor ? [voice.flavor] : []))),
  voices: sorted(VOICE_NAMES),
  flavorScopes: flavorScopes().sort(
    (a, b) =>
      a.race.localeCompare(b.race) ||
      a.gender.localeCompare(b.gender) ||
      a.flavor.localeCompare(b.flavor),
  ),
  zones: QUEST_ZONES,
};

/** Async because it used to be read off the corpus; kept so no caller has to change. */
export async function facets(): Promise<Facets> {
  return FACETS;
}

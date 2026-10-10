/**
 * The values the filter dropdowns can offer.
 *
 * The roster (migration 0071, roster-store.ts), so a type or voice an admin adds is filterable
 * before any line uses it, and the filters, /voices and the triage selects offer the same set.
 *
 * Being closed sets also makes them a whitelist, which is what lets /api/search take these
 * straight from a query string.
 *
 * `source` and `npcType` are absent on purpose: they are closed unions on CorpusLine, so
 * their lists live next to the type in lib/search.ts.
 */
import type { RosterData } from "./voices/roster";
import { loadRoster } from "./voices/roster-store";

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
  /** The whole roster, for the controls that answer who an NPC is. */
  roster: RosterData;
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export async function facets(): Promise<Facets> {
  const roster = await loadRoster();
  return {
    races: roster.races,
    genders: ["female", "male"],
    flavors: sorted(roster.data.flavors.map((flavor) => flavor.flavor)),
    voices: roster.voiceNames,
    // A genderless type's flavors match a race with no gender chosen.
    flavorScopes: roster.flavorScopes().map((scope) => ({ ...scope, gender: scope.gender ?? "" })),
    roster: roster.data,
  };
}

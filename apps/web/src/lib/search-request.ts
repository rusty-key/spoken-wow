/**
 * Reading filters off a query string.
 *
 * Shared by /api/search and /api/search/lines so a page and the batch it offers to
 * regenerate can never disagree about what "matching" means.
 *
 * Unknown values are dropped rather than rejected: every one of these comes from a closed
 * set (lib/facets.ts, and the unions in lib/search.ts), so anything else is a stale link or
 * a hand-edited URL, and answering it with the unfiltered corpus is both safe and more
 * useful than a 400.
 */
import { facets } from "./facets";
import { NPC_TYPES, SOURCES } from "./line-fields";
import type { Filter, LineFilters } from "./search";

const FILTERS: Filter[] = ["any", "npc", "quest", "text"];

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Async because the facets are: the corpus is a table now, so which races and voices exist
 * is a question with a current answer rather than a constant baked into the release.
 */
export async function filtersFromParams(params: URLSearchParams): Promise<LineFilters> {
  const { races, genders, flavors, voices } = await facets();

  return {
    q: params.get("q") ?? "",
    filter: oneOf(params.get("filter"), FILTERS) ?? "any",
    missingOnly: params.get("missing") === "1",
    race: oneOf(params.get("race"), races),
    gender: oneOf(params.get("gender"), genders),
    flavor: oneOf(params.get("flavor"), flavors),
    voice: oneOf(params.get("voice"), voices),
    source: oneOf(params.get("source"), SOURCES),
    npcType: oneOf(params.get("type"), NPC_TYPES),
    narration: params.get("narration") === "1",
    // Absent means hidden, so the default state needs no parameter and a bare URL is the
    // useful view rather than the padded one.
    includeProgress: params.get("progress") === "1",
    line: params.get("line") || undefined,
    overridden: params.get("overridden") === "1",
    // Absent means hidden, like progress text: the useful default view is the corpus minus
    // the lines nobody will ever voice.
    ignored: params.get("ignored") === "1",
    outdated: params.get("outdated") === "1",
    dirty: params.get("dirty") === "1",
    reports: oneOf(params.get("fb"), ["open"] as const),
    // Kept as the raw day. dayStart is what decides whether it is a date, so there is one
    // definition of that rather than one here and another in the filter.
    generatedBefore: params.get("before") || undefined,
    generatedAfter: params.get("after") || undefined,
  };
}

/** Whether staleness has to be answered for the whole corpus, which is a query and a hash per take. */
export function needsStale(filters: LineFilters): boolean {
  return Boolean(filters.outdated);
}

/** The same question for pronunciation: one query plus a substring pass per changed word. */
export function needsDirty(filters: LineFilters): boolean {
  return Boolean(filters.dirty);
}

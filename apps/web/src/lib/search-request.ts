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
import { audioStateFromParams } from "./audio-state";
import { facets } from "./facets";
import { KINDS, NPC_TYPES, SOURCES } from "./line-fields";
import { RECORDED } from "./recordings/live";
import type { Filter, LineFilters } from "./search";

const FILTERS: Filter[] = ["any", "npc", "quest", "text"];

function zoneOf(value: string | null, zones: readonly { uiMapID: number }[]): number | undefined {
  const id = Number(value);
  return value && zones.some((zone) => zone.uiMapID === id) ? id : undefined;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Async because the facets are: the corpus is a table now, so which races and voices exist
 * is a question with a current answer rather than a constant baked into the release.
 */
export async function filtersFromParams(params: URLSearchParams): Promise<LineFilters> {
  const { races, genders, flavors, voices, zones } = await facets();

  return {
    q: params.get("q") ?? "",
    filter: oneOf(params.get("filter"), FILTERS) ?? "any",
    state: audioStateFromParams(params),
    race: oneOf(params.get("race"), races),
    gender: oneOf(params.get("gender"), genders),
    flavor: oneOf(params.get("flavor"), flavors),
    voice: oneOf(params.get("voice"), voices),
    kind: oneOf(params.get("kind"), KINDS),
    source: oneOf(params.get("source"), SOURCES),
    npcType: oneOf(params.get("type"), NPC_TYPES),
    zone: zoneOf(params.get("zone"), zones),
    narration: params.get("narration") === "1",
    // Absent means hidden, so the default state needs no parameter and a bare URL is the
    // useful view rather than the padded one.
    includeProgress: params.get("progress") === "1",
    line: params.get("line") || undefined,
    overridden: params.get("overridden") === "1",
    // Absent means hidden, like progress text: the useful default view is the corpus minus
    // the lines nobody will ever voice.
    ignored: params.get("ignored") === "1",
    dirty: params.get("dirty") === "1",
    reports: oneOf(params.get("fb"), ["open"] as const),
    // Kept as the raw day. dayStart is what decides whether it is a date, so there is one
    // definition of that rather than one here and another in the filter.
    generatedBefore: params.get("before") || undefined,
    generatedAfter: params.get("after") || undefined,
    // Not checked against a closed set: the models and authors are whatever the takes hold.
    // One nothing made matches nothing, which is the truthful answer.
    model: params.get("model") || undefined,
    author: params.get("author") || undefined,
    recorded: oneOf(params.get("rec"), RECORDED),
  };
}

/**
 * The filters with the model and author dropped, for somebody who may not see either. Dropped
 * rather than left to match nothing, the way an unknown facet is: a translator's link opened
 * by a visitor should show the lines, not an empty table.
 */
export function withoutMadeBy(filters: LineFilters): LineFilters {
  return { ...filters, model: undefined, author: undefined };
}

/** Whether staleness has to be answered for the whole corpus, which is a query and a hash per take. */
export function needsStale(filters: LineFilters): boolean {
  return filters.state === "stale" || filters.state === "current";
}

/** The same question for pronunciation: one query plus a substring pass per changed word. */
export function needsDirty(filters: LineFilters): boolean {
  return Boolean(filters.dirty);
}

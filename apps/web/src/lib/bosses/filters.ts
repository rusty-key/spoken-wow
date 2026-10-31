// The bosses filter vocabulary, and its translation to and from a query string.
//
// CLIENT-SAFE ON PURPOSE, for the reason lib/places/filters.ts gives: the catalogue is
// server-only, so everything a client component needs as a value lives here.

import { RECORDED, type Recorded } from "@/lib/recordings/live";
import { REPORTS, SHORT_LINE, STATES, type Reports, type State } from "@/lib/places/filters";

export { REPORTS, SHORT_LINE, STATES, type Reports, type State };

export const FIELDS = ["any", "name", "instance", "text"] as const;

export type Field = (typeof FIELDS)[number];

export type LineFilters = {
  q?: string;
  /** Which field the free-text query is matched against. */
  field?: Field;
  /** The instance's map id. */
  mapID?: number;
  state?: State;
  /** Audio cut before a pronunciation it speaks was changed; see lib/places/filters.ts. */
  dirty?: boolean;
  /** Under SHORT_LINE spoken characters. */
  short?: boolean;
  reports?: Reports;
  /** One line id, which is how a report on /reports links into this explorer. */
  line?: string;
  generatedBefore?: string; // YYYY-MM-DD
  generatedAfter?: string;
  model?: string;
  author?: string;
  recorded?: Recorded;
};

export const PAGE_SIZE = 100;

export function filterParams(filters: LineFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.field && filters.field !== "any") params.set("field", filters.field);
  if (filters.mapID !== undefined) params.set("instance", String(filters.mapID));
  if (filters.state) params.set("state", filters.state);
  if (filters.dirty) params.set("dirty", "1");
  if (filters.short) params.set("short", "1");
  if (filters.reports) params.set("fb", filters.reports);
  if (filters.line) params.set("line", filters.line);
  if (filters.generatedBefore) params.set("before", filters.generatedBefore);
  if (filters.generatedAfter) params.set("after", filters.generatedAfter);
  if (filters.model) params.set("model", filters.model);
  if (filters.author) params.set("author", filters.author);
  if (filters.recorded) params.set("rec", filters.recorded);
  return params;
}

// A hand-edited URL produces "no filter" rather than one nothing can match, which would read
// as missing data.
function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function filtersFromParams(params: URLSearchParams): LineFilters {
  const mapID = Number(params.get("instance"));
  const before = params.get("before");
  const after = params.get("after");

  return {
    q: params.get("q") ?? undefined,
    field: oneOf(params.get("field"), FIELDS),
    mapID: Number.isInteger(mapID) && mapID > 0 ? mapID : undefined,
    state: oneOf(params.get("state"), STATES),
    dirty: params.get("dirty") === "1" || undefined,
    short: params.get("short") === "1" || undefined,
    reports: oneOf(params.get("fb"), REPORTS),
    line: params.get("line") || undefined,
    generatedBefore: before && DATE.test(before) ? before : undefined,
    generatedAfter: after && DATE.test(after) ? after : undefined,
    model: params.get("model") || undefined,
    author: params.get("author") || undefined,
    recorded: oneOf(params.get("rec"), RECORDED),
  };
}

// The free-text query counts; `field` alone narrows nothing, so it does not.
export function activeFilterCount(filters: LineFilters): number {
  return [
    filters.q,
    filters.mapID,
    filters.state,
    filters.dirty,
    filters.short,
    filters.reports,
    filters.line,
    filters.generatedBefore,
    filters.generatedAfter,
    filters.model,
    filters.author,
    filters.recorded,
  ].filter(Boolean).length;
}

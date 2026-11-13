// The readables filter vocabulary, and its translation to and from a query string.
//
// CLIENT-SAFE ON PURPOSE, exactly as lib/places/filters.ts is: the catalogue reaches the
// pipeline and the database, so a client component may import types from it but never a
// runtime value. Everything both sides need lives here.

import { RECORDED, type Recorded } from "@/lib/recordings/live";

export const FIELDS = ["any", "title", "text"] as const;
export const OWNER_KINDS = ["object", "item"] as const;
export const STATES = ["missing", "stale", "current"] as const;
// One value rather than a boolean, so "resolved" or "any" can be added later without
// changing the shape of a URL somebody has already shared.
export const REPORTS = ["open"] as const;

export type Field = (typeof FIELDS)[number];
/** What opens the book: a GameObject in the world, or an item in a bag. */
export type OwnerKind = (typeof OWNER_KINDS)[number];

/** What entity_name calls an owner's kind: book_line says 'object' for a gameobject. */
export function ownerEntityKind(kind: OwnerKind): "gameobject" | "item" {
  return kind === "object" ? "gameobject" : "item";
}
/** missing = no audio; stale = audio predates a text change; current = neither. */
export type State = (typeof STATES)[number];
export type Reports = (typeof REPORTS)[number];

export type PageFilters = {
  q?: string;
  /** Which field the free-text query is matched against. */
  field?: Field;
  ownerKind?: OwnerKind;
  /** A chain's first page. Selects every page of that one book. */
  bookId?: string;
  state?: State;
  /**
   * Audio cut before a pronunciation it speaks was changed, and not since judged.
   *
   * Not a value of `state`, which is about text: a page whose text has not moved is
   * `current` and can be dirty at the same time, and folding the two would make each
   * answer hide the other.
   */
  dirty?: boolean;
  /**
   * true for only the pages that can be voiced at all, false for only those that cannot.
   *
   * 88 of the 1191 cannot: 36 hold substitution tokens the game fills in at runtime, 26
   * are empty and 26 say "Missing Text". They are in the corpus deliberately -- the game
   * has them -- so hiding them has to be a filter rather than an omission.
   */
  voiceable?: boolean;
  /** 'open' selects pages carrying at least one unresolved report. */
  reports?: Reports;
  /** One page id, which is how a report on /reports links into this explorer. */
  line?: string;
  /**
   * The live take's model as lib/takes/made-by.ts labels it ("eleven:v3"), and the id of
   * who made it. Honoured only for somebody working in the language; see the search route.
   */
  model?: string;
  author?: string;
  /** Whether a voice actor has recorded it. Honoured only for somebody who records here. */
  recorded?: Recorded;
};

export const PAGE_SIZE = 100;

// item_template.page_material, as the client draws it. 0 is what the extract records for
// GameObject books, whose material comes from the display rather than from the template,
// so it reads as the default parchment.
export const MATERIALS: Record<number, string> = {
  0: "parchment",
  1: "parchment",
  2: "stone",
  3: "marble",
  4: "silver",
  5: "bronze",
  6: "valentine",
  7: "illidan",
};

export function materialName(material: number): string {
  return MATERIALS[material] ?? "parchment";
}

// Short keys, because the whole filter set rides in the URL and a shared link should stay
// readable.
export function filterParams(filters: PageFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.field && filters.field !== "any") params.set("field", filters.field);
  if (filters.ownerKind) params.set("kind", filters.ownerKind);
  if (filters.bookId !== undefined) params.set("book", filters.bookId);
  if (filters.state) params.set("state", filters.state);
  if (filters.dirty) params.set("dirty", "1");
  if (filters.voiceable !== undefined) params.set("voiceable", filters.voiceable ? "1" : "0");
  if (filters.reports) params.set("fb", filters.reports);
  if (filters.line) params.set("line", filters.line);
  if (filters.model) params.set("model", filters.model);
  if (filters.author) params.set("author", filters.author);
  if (filters.recorded) params.set("rec", filters.recorded);
  return params;
}

// Every closed set is validated against its constant rather than trusted, so a hand-edited
// URL produces "no filter" instead of a filter nothing can match -- which would look like
// an empty result set and read as missing data.
function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function filtersFromParams(params: URLSearchParams): PageFilters {
  const book = params.get("book");

  return {
    q: params.get("q") ?? undefined,
    field: oneOf(params.get("field"), FIELDS),
    ownerKind: oneOf(params.get("kind"), OWNER_KINDS),
    bookId: book && /^(\d+|n[0-9a-f-]{36})$/.test(book) ? book : undefined,
    state: oneOf(params.get("state"), STATES),
    dirty: params.get("dirty") === "1" || undefined,
    voiceable: params.get("voiceable") === "1" ? true : params.get("voiceable") === "0" ? false : undefined,
    reports: oneOf(params.get("fb"), REPORTS),
    line: params.get("line") || undefined,
    model: params.get("model") || undefined,
    author: params.get("author") || undefined,
    recorded: oneOf(params.get("rec"), RECORDED),
  };
}

// Powers the "clear all N filters" button, which is all it is for. The free-text query
// counts: a "clear all" that left it in force would lie about what you are looking at.
export function activeFilterCount(filters: PageFilters): number {
  return [
    filters.q,
    filters.ownerKind,
    filters.bookId,
    filters.state,
    filters.dirty,
    filters.voiceable !== undefined,
    filters.reports,
    filters.line,
    filters.model,
    filters.author,
    filters.recorded,
  ].filter(Boolean).length;
}

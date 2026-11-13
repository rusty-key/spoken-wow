// Filtering, as a pure function of the corpus.
//
// Everything database-backed arrives in a SearchContext rather than being fetched here,
// which is the split lib/places/search.ts makes and the reason this is testable with no
// database and no filesystem. 1191 rows filter in a linear chain per request; there is no
// index and at this size there does not need to be one.
//
// THE STATE DEFINITIONS MUST MATCH THE GENERATOR'S. `stale` is take.textHash !== page.hash,
// where the hash is sha1 of the SPOKEN text, because that is what decides which lines a
// regeneration pass picks up. If these two ever disagree, the explorer is lying about what
// needs regenerating.

import { isDirty } from "@/lib/generation/dirty";
import { recordedMatches, type LiveRecording } from "@/lib/recordings/live";
import { madeByFacets, madeByMatches, type MadeBy, type MadeByFacets } from "@/lib/takes/made-by";

import type { BookPage, SearchContext, Take } from "./catalogue";
import { PAGE_SIZE, type Field, type PageFilters, type OwnerKind, type State } from "./filters";

export type ResultLine = {
  /** 'b:1381'. Unique by construction: one page is one line. */
  id: string;
  pageId: number | null;
  key: string;
  bookId: string;
  pageNumber: number;
  pageCount: number;
  title: string;
  ownerKind: OwnerKind | null;
  ownerIds: number[];
  material: number;
  text: string;
  spoken: string;
  chars: number;
  file: string;
  generatable: boolean;
  skipReason: string | null;
  state: State;
  take: Take | null;
  /** How many reports on this page are still open. The count is public; the bodies are not. */
  reportsOpen: number;
  /**
   * This take was cut before a pronunciation it speaks was changed, and nobody has said it
   * is fine since. Orthogonal to `state`: a lexicon edit moves no text, so a take can be
   * current and dirty at once. Cleared by hand only -- see lib/generation/dirty.ts.
   */
  dirty: boolean;
  /** See BookPage.missing. Absent when reading English, and where nothing is missing. */
  missing?: { text: boolean; title: boolean };
  /** The English page, for a translator to work from. Absent when reading English. */
  english?: string;
  /** The owner's English name, for a translator. Absent when reading English. */
  englishTitle?: string;
  /** Who and what made the live take. Null with no take, or when the viewer may not know. */
  madeBy: MadeBy | null;
  /** The live voice-actor recording, or null. Absent for anybody who does not record here. */
  recording?: LiveRecording | null;
};

export type SearchResult = {
  lines: ResultLine[];
  /** Across every page of results, not just the one shown. */
  total: number;
  /** What the current filter selects, for the header and the regenerate quote. */
  totalChars: number;
  counts: Record<State, number>;
  /** How many of the matched pages are dirty. Not a fourth state; see ResultLine.dirty. */
  dirty: number;
  offset: number;
  limit: number;
  /** What the model and author chips offer. Absent when the context carried no `madeBy`. */
  madeBy?: MadeByFacets;
  /**
   * The viewer records in this language, so every row carries `recording` and the page draws
   * the voice actor column. The server's answer rather than a grant check in the browser,
   * for the reason components/MadeBy.tsx gives.
   */
  recordable?: true;
};

export function stateOf(page: BookPage, take: Take | undefined): State {
  if (!take) return "missing";
  return take.textHash === page.hash ? "current" : "stale";
}

export function decorate(page: BookPage, context: SearchContext): ResultLine {
  const take = context.takes.get(page.id);
  return {
    id: page.id,
    pageId: page.pageId,
    key: page.key,
    bookId: page.bookId,
    pageNumber: page.pageNumber,
    pageCount: page.pageCount,
    title: page.title,
    ownerKind: page.ownerKind,
    ownerIds: page.ownerIds,
    material: page.material,
    text: page.text,
    spoken: page.spoken,
    chars: page.spoken.length,
    file: page.file,
    generatable: page.generatable,
    skipReason: page.skipReason,
    state: stateOf(page, take),
    take: take ?? null,
    reportsOpen: context.reports.get(page.id) ?? 0,
    madeBy: context.madeBy?.get(page.id) ?? null,
    ...(context.recordings && { recording: context.recordings.get(page.file) ?? null }),
    ...(page.missing ? { missing: page.missing } : {}),
    ...(page.english === undefined
      ? {}
      : { english: page.english, englishTitle: page.englishTitle }),
    // The spoken text, not the printed one: the lexicon is applied to what is sent.
    dirty: take
      ? isDirty(
          { file: page.file, text: page.spoken, generatedAt: Date.parse(take.generatedAt) },
          context.dirt,
        )
      : false,
  };
}

function matchesQuery(line: ResultLine, needle: string, field: Field): boolean {
  const q = needle.toLowerCase();
  switch (field) {
    case "title":
      return line.title.toLowerCase().includes(q);
    case "text":
      return line.text.toLowerCase().includes(q);
    default:
      return line.title.toLowerCase().includes(q) || line.text.toLowerCase().includes(q);
  }
}

export function matching(lines: ResultLine[], filters: PageFilters = {}): ResultLine[] {
  let out = lines;

  if (filters.q) {
    const needle = filters.q.trim();
    if (needle) out = out.filter((l) => matchesQuery(l, needle, filters.field ?? "any"));
  }
  if (filters.ownerKind) out = out.filter((l) => l.ownerKind === filters.ownerKind);
  if (filters.bookId !== undefined) out = out.filter((l) => l.bookId === filters.bookId);
  if (filters.state) out = out.filter((l) => l.state === filters.state);
  // Its own filter rather than a fourth state, because a current take can be dirty.
  if (filters.dirty) out = out.filter((l) => l.dirty);
  if (filters.voiceable !== undefined) out = out.filter((l) => l.generatable === filters.voiceable);
  if (filters.reports === "open") out = out.filter((l) => l.reportsOpen > 0);
  // An id the corpus no longer carries matches nothing rather than everything: a report
  // about a page that has since been dropped must not read as "here it is".
  if (filters.line) out = out.filter((l) => l.id === filters.line);
  if (filters.model || filters.author) out = out.filter((l) => madeByMatches(l.madeBy ?? undefined, filters));
  if (filters.recorded) out = out.filter((l) => recordedMatches(l.recording, filters.recorded));

  return out;
}

// Deterministic and total, because paging a list whose order can shift drops and repeats
// rows between pages. A book's pages in reading order, books by title -- and the id last,
// because 381 titles cover 404 books and two of them would otherwise tie.
function order(lines: ResultLine[]): ResultLine[] {
  return [...lines].sort(
    (a, b) =>
      a.title.localeCompare(b.title) ||
      a.bookId.localeCompare(b.bookId, undefined, { numeric: true }) ||
      a.pageNumber - b.pageNumber ||
      a.id.localeCompare(b.id),
  );
}

export function search(
  pages: BookPage[],
  context: SearchContext,
  filters: PageFilters = {},
  offset = 0,
  limit = PAGE_SIZE,
): SearchResult {
  const all = pages.map((page) => decorate(page, context));
  const matched = order(matching(all, filters));

  const counts: Record<State, number> = { missing: 0, stale: 0, current: 0 };
  let totalChars = 0;
  let dirty = 0;
  for (const line of matched) {
    counts[line.state]++;
    if (line.dirty) dirty++;
    totalChars += line.chars;
  }

  return {
    lines: matched.slice(offset, offset + limit),
    total: matched.length,
    totalChars,
    counts,
    dirty,
    offset,
    limit,
    ...(context.madeBy && { madeBy: madeByFacets(context.madeBy.values()) }),
    ...(context.recordings && { recordable: true as const }),
  };
}

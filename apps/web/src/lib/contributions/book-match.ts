/**
 * Which page a readables contribution is, and what accepting it would do.
 *
 * The envelope names no page: its key is the checksum of the text on screen. So the page is
 * found the way a person would find it, most certain first -- the item or object the client
 * read it from, the same words in any language, then the title and page number the client
 * showed -- and where two candidates remain, nothing is guessed. A moderator's answer, stored on
 * the contribution, overrides all of it.
 *
 * Computed against the corpus as it stands, never stored: once a new book's first page is
 * accepted, its other pages find it by title.
 */
import { normaliseText } from "@readables-tools/lib/text.mjs";

import type { PoolClient } from "pg";

import { db } from "@/lib/db";
import { BASE_LANG } from "@/lib/lang";
import { memoByLang } from "@/lib/memo";
import { bookPageStamp, versionStamp } from "@/lib/stamp";

export type BookCorpusPage = {
  lineId: string;
  bookId: string;
  pageNumber: number;
  ownerKind: "object" | "item" | null;
  ownerIds: number[];
  /** lang -> current text */
  texts: Map<string, string>;
  /**
   * lang -> every title a client in that language may show: each owner's entity_name, then the
   * page's own. The first is the one shown, the first owner's name where it has one.
   */
  titles: Map<string, string[]>;
};
export type BookCorpus = {
  pages: BookCorpusPage[];
  /** normalised words, in any language -> the pages that have them */
  byText: Map<string, BookCorpusPage[]>;
  /** lineId -> lang -> normalised words */
  normalised: Map<string, Map<string, string>>;
  /** `${lang}\u0000${title}` -> bookIds */
  byTitle: Map<string, Set<string>>;
  /** `${bookId}\u0000${pageNumber}` -> page */
  byPlace: Map<string, BookCorpusPage>;
  /** `${kind}:${id}` -> bookIds */
  byOwner: Map<string, Set<string>>;
};

export type BookMatchInput = {
  locale: string;
  text: string | null;
  meta: Record<string, string>;
  matchLineId: string | null;
  matchBookId: string | null;
  matchPageNumber: number | null;
  matchNewBook: boolean;
};

export type BookMatchResult =
  | { kind: "known"; lineId: string; via: MatchVia }
  | { kind: "correction"; lineId: string; current: string; via: MatchVia }
  | { kind: "translation"; lineId: string; via: MatchVia }
  | { kind: "new-page"; bookId: string; pageNumber: number; via: MatchVia }
  | { kind: "new-book"; title: string; pageNumber: number; via: MatchVia }
  | { kind: "ambiguous"; candidates: string[] };
export type MatchVia = "moderator" | "owner" | "text" | "title" | "none";

/**
 * Whether accepting many rows at once may take a row with this match. A new book is minted only
 * by accepting its row on its own: a title no corpus book has may still be one under another
 * title. A correction replaces words the page has, so it is taken from the Corrections tab.
 */
export const bulkAcceptable = (match: BookMatchResult) =>
  match.kind === "translation" || match.kind === "new-page";

/**
 * A match a request carries back, as the table showed it, or undefined when the value is not
 * one. Only what sameMatch compares is checked; `via` and `current` are not read.
 */
export function bookMatchOf(value: unknown): BookMatchResult | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const m = value as Record<string, unknown>;
  const page = Number.isInteger(m.pageNumber);
  switch (m.kind) {
    case "known":
    case "correction":
    case "translation":
      return typeof m.lineId === "string" ? (value as BookMatchResult) : undefined;
    case "new-page":
      return typeof m.bookId === "string" && page ? (value as BookMatchResult) : undefined;
    case "new-book":
      return typeof m.title === "string" && page ? (value as BookMatchResult) : undefined;
    case "ambiguous":
      return Array.isArray(m.candidates) && m.candidates.every((c) => typeof c === "string")
        ? (value as BookMatchResult)
        : undefined;
    default:
      return undefined;
  }
}

/** Whether two matches would write the same thing: the same kind, at the same page or place. */
export function sameMatch(a: BookMatchResult, b: BookMatchResult): boolean {
  const target = (m: BookMatchResult) => {
    switch (m.kind) {
      case "known":
      case "correction":
      case "translation":
        return `${m.kind}\u0000${m.lineId}`;
      case "new-page":
        return `${m.kind}\u0000${m.bookId}\u0000${m.pageNumber}`;
      case "new-book":
        return `${m.kind}\u0000${m.title}\u0000${m.pageNumber}`;
      case "ambiguous":
        return `${m.kind}\u0000${m.candidates.join(",")}`;
    }
  };
  return target(a) === target(b);
}

const normal = (text: string) => (normaliseText(text) as string).trim();

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

/** The lookups matchBook uses, built once so a call never re-reads a page's words. */
export function indexCorpus(pages: BookCorpusPage[]): BookCorpus {
  const byTextSets = new Map<string, Set<BookCorpusPage>>();
  const normalised = new Map<string, Map<string, string>>();
  const byTitle = new Map<string, Set<string>>();
  const byPlace = new Map<string, BookCorpusPage>();
  const byOwner = new Map<string, Set<string>>();
  for (const page of pages) {
    const own = new Map<string, string>();
    for (const [lang, text] of page.texts) {
      const said = normal(text);
      own.set(lang, said);
      addTo(byTextSets, said, page);
    }
    normalised.set(page.lineId, own);
    for (const [lang, titles] of page.titles) {
      for (const title of titles) addTo(byTitle, `${lang}\u0000${title.trim()}`, page.bookId);
    }
    byPlace.set(`${page.bookId}\u0000${page.pageNumber}`, page);
    if (page.ownerKind) for (const id of page.ownerIds) addTo(byOwner, `${page.ownerKind}:${id}`, page.bookId);
  }
  const byText = new Map([...byTextSets].map(([said, set]) => [said, [...set]]));
  return { pages, byText, normalised, byTitle, byPlace, byOwner };
}

function pageNumberOf(meta: Record<string, string>): number {
  const number = Number(meta.number);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

function onPage(page: BookCorpusPage, said: string, row: BookMatchInput, corpus: BookCorpus, via: MatchVia): BookMatchResult {
  const current = page.texts.get(row.locale);
  if (current === undefined) return { kind: "translation", lineId: page.lineId, via };
  if (said !== "" && corpus.normalised.get(page.lineId)?.get(row.locale) === said) return { kind: "known", lineId: page.lineId, via };
  return { kind: "correction", lineId: page.lineId, current, via };
}

function inBook(corpus: BookCorpus, bookId: string, pageNumber: number, said: string, row: BookMatchInput, via: MatchVia): BookMatchResult {
  const page = corpus.byPlace.get(`${bookId}\u0000${pageNumber}`);
  return page ? onPage(page, said, row, corpus, via) : { kind: "new-page", bookId, pageNumber, via };
}

export function titleIn(page: BookCorpusPage | undefined, lang: string): string {
  return page?.titles.get(lang)?.[0] ?? page?.titles.get(BASE_LANG)?.[0] ?? [...(page?.titles.values() ?? [])][0]?.[0] ?? "untitled";
}

/** One page or book an ambiguous row may be, with enough to tell it from same-named others. */
export type BookCandidate = {
  key: string;
  answer: { lineId: string } | { bookId: string; pageNumber: number };
  label: string;
  bookId: string;
  /** The page shown for it: the row's own, or the book's first when the book has no such page. */
  lineId: string;
  excerpt: string | null;
  owner: { kind: "object" | "item"; id: number } | null;
};

const EXCERPT_LENGTH = 120;

/** An ambiguous match's candidates: page ids when the words matched, book ids when only the title did. */
export function bookCandidates(
  match: BookMatchResult,
  corpus: BookCorpus,
  row: Pick<BookMatchInput, "locale" | "meta">,
): BookCandidate[] {
  if (match.kind !== "ambiguous") return [];
  const pageNumber = pageNumberOf(row.meta);
  return match.candidates.flatMap((candidate) => {
    const isPage = candidate.startsWith("b:");
    const bookId = isPage ? null : candidate;
    const own = isPage ? corpus.pages.find((p) => p.lineId === candidate) : corpus.byPlace.get(`${bookId}\u0000${pageNumber}`);
    const page = own ?? corpus.pages.filter((p) => p.bookId === bookId).sort((a, b) => a.pageNumber - b.pageNumber)[0];
    if (!page) return [];
    const text = page.texts.get(row.locale) ?? page.texts.get(BASE_LANG) ?? [...page.texts.values()][0];
    return [{
      key: candidate,
      answer: isPage ? { lineId: candidate } : { bookId: page.bookId, pageNumber },
      label: `${titleIn(page, row.locale)} p.${isPage ? page.pageNumber : pageNumber}${own ? "" : " (new page)"}`,
      bookId: page.bookId,
      lineId: page.lineId,
      excerpt: text ? text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_LENGTH) : null,
      owner: page.ownerKind && page.ownerIds.length > 0 ? { kind: page.ownerKind, id: page.ownerIds[0] } : null,
    }];
  });
}

export function matchBook(row: BookMatchInput, corpus: BookCorpus): BookMatchResult {
  const pageNumber = row.matchPageNumber ?? pageNumberOf(row.meta);
  const title = row.meta.book?.trim() ?? "";
  const said = row.text ? normal(row.text) : "";

  if (row.matchLineId) {
    const page = corpus.pages.find((p) => p.lineId === row.matchLineId);
    if (page) return onPage(page, said, row, corpus, "moderator");
  }
  if (row.matchBookId) return inBook(corpus, row.matchBookId, pageNumber, said, row, "moderator");
  if (row.matchNewBook) return { kind: "new-book", title, pageNumber, via: "moderator" };

  // 1. What the client read it from.
  for (const kind of ["item", "object"] as const) {
    const id = Number(row.meta[kind]);
    if (!Number.isInteger(id) || id <= 0) continue;
    const books = corpus.byOwner.get(`${kind}:${id}`);
    if (books?.size === 1) return inBook(corpus, [...books][0], pageNumber, said, row, "owner");
  }

  // 2. The same words, in any language.
  if (said !== "") {
    const same = corpus.byText.get(said) ?? [];
    if (same.length === 1) return onPage(same[0], said, row, corpus, "text");
    if (same.length > 1) {
      // The same words in this language on one page is that page, whatever else repeats them.
      const own = same.filter((p) => corpus.normalised.get(p.lineId)?.get(row.locale) === said);
      if (own.length === 1) return onPage(own[0], said, row, corpus, "text");
      // Otherwise the contributor's title, in its language and then in any, and its page number
      // may tell the copies apart.
      const named = (p: BookCorpusPage, lang?: string) =>
        [...p.titles].some(([l, ts]) => (lang === undefined || l === lang) && ts.some((t) => t.trim() === title));
      let narrowed = title ? same.filter((p) => named(p, row.locale)) : [];
      if (title && narrowed.length === 0) narrowed = same.filter((p) => named(p));
      if (narrowed.length === 1) return onPage(narrowed[0], said, row, corpus, "text");
      if (narrowed.length > 1) {
        const numbered = narrowed.filter((p) => p.pageNumber === pageNumber);
        if (numbered.length === 1) return onPage(numbered[0], said, row, corpus, "text");
        if (numbered.length > 1) narrowed = numbered;
      }
      const left = narrowed.length > 0 ? narrowed : same;
      return { kind: "ambiguous", candidates: left.map((p) => p.lineId).sort() };
    }
  }

  // 3. The title and page number, in this language.
  if (title) {
    const found = corpus.byTitle.get(`${row.locale}\u0000${title}`);
    if (found && found.size === 1) return inBook(corpus, [...found][0], pageNumber, said, row, "title");
    if (found && found.size > 1) return { kind: "ambiguous", candidates: [...found].sort() };
  }

  // 4. Nothing has it.
  return { kind: "new-book", title, pageNumber, via: "none" };
}

const corpusKey = Symbol.for("spoken.readables-corpus");

/**
 * Every live page with each language's current words and the title its clients show.
 *
 * Kept while book_page, book_line and the owners' names stand still, validated rather than
 * invalidated as the readables catalogue is. The stamp is read on `client`, so a caller in a
 * transaction compares against what other transactions have committed by then.
 */
export async function loadBookCorpus(client?: Pick<PoolClient, "query">): Promise<BookCorpus> {
  const q = client ?? db();
  const { rows } = await q.query<{ stamp: string }>(
    `select ${versionStamp("book_line", "true")} || '|' || ${bookPageStamp()} || '|' ||
            ${versionStamp("entity_name", `"kind" in ('item', 'gameobject')`)} as "stamp"`,
  );
  return memoByLang(corpusKey, "", rows[0]?.stamp ?? "", () => readCorpus(q));
}

async function readCorpus(q: Pick<PoolClient, "query">): Promise<BookCorpus> {
  const { rows } = await q.query<{
    lineId: string; bookId: string; pageNumber: number; ownerKind: "object" | "item" | null;
    ownerIds: number[] | null; lang: string | null; text: string | null; title: string | null;
  }>(
    `select p."lineId", p."bookId", p."pageNumber", p."ownerKind", p."ownerIds", l."lang", l."text", l."title"
       from "book_page" p
       left join "book_line" l on l."lineId" = p."lineId" and l."isCurrent"
      where p."aliasOf" is null`,
  );
  const { rows: names } = await q.query<{ lineId: string; lang: string; name: string }>(
    `select p."lineId", n."lang", n."name"
       from "book_page" p
       cross join lateral unnest(p."ownerIds") with ordinality as o("id", "ord")
       join "entity_name" n on n."kind" = case p."ownerKind" when 'object' then 'gameobject' else 'item' end
                           and n."entityId" = o."id"::text and n."isCurrent"
      where p."aliasOf" is null and p."ownerKind" is not null
      order by p."lineId", o."ord"`,
  );
  const pages = new Map<string, BookCorpusPage>();
  const titled = (page: BookCorpusPage, lang: string, title: string | null) => {
    const trimmed = title?.trim();
    if (!trimmed) return;
    const titles = page.titles.get(lang);
    if (!titles) page.titles.set(lang, [trimmed]);
    else if (!titles.includes(trimmed)) titles.push(trimmed);
  };
  for (const row of rows) {
    let page = pages.get(row.lineId);
    if (!page) {
      page = { lineId: row.lineId, bookId: row.bookId, pageNumber: row.pageNumber, ownerKind: row.ownerKind,
        ownerIds: row.ownerIds ?? [], texts: new Map(), titles: new Map() };
      pages.set(row.lineId, page);
    }
    if (row.lang && row.text !== null) page.texts.set(row.lang, row.text);
  }
  // Owners' names first, in owner order, so a language's first title is the one its clients show.
  for (const { lineId, lang, name } of names) {
    const page = pages.get(lineId);
    if (page) titled(page, lang, name);
  }
  for (const row of rows) if (row.lang) titled(pages.get(row.lineId)!, row.lang, row.title);
  return indexCorpus([...pages.values()]);
}

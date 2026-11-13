// The readables corpus, built from `book_line`.
//
// SERVER ONLY. The table is the corpus; the addon's Data/*.lua is an export of it, so the
// app reads the table and never the files -- reading the Lua here would show whatever was
// last exported and committed, and would let the explorer list pages it cannot save.
//
// Pure helpers still come from the pipeline (lib/readables/tools.ts): normalising and hashing
// are the same operations the CLI performs, and a second implementation here is how the app
// and the generated audio start disagreeing about what is stale.

import "server-only";

import { query } from "@/lib/db";
import type { LiveRecording } from "@/lib/recordings/live";
import { memoByLang } from "@/lib/memo";
import { bookPageStamp, nameStamp, versionStamp } from "@/lib/stamp";
import { loadDirtyContext, NO_DIRT, type DirtyContext } from "@/lib/generation/dirty";

import { ownerEntityKind, type OwnerKind } from "./filters";
import {
  spokenText,
  spokenHash,
  textHash,
  fileFor,
  isGeneratable,
  spokenWithTitle,
  pageKeyOf,
  lineIdOfKey,
} from "./tools";
import { speakPlayerTokens } from "@/lib/player-words";
import { madeByOf, type MadeBy } from "@/lib/takes/made-by";
import { liveTakes } from "@/lib/takes/store";
import { readAs } from "@/lib/teams/store";

import { BASE_LANG, type Lang } from "@/lib/lang";

/** One voiceable page of one book. */
export type BookPage = {
  /** 'b:1381' or 'b:n{uuid}'. naming.mjs owns the format. */
  id: string;
  /** '1381' or 'n{uuid}': the landing URL's and the addon's name for the page. */
  key: string;
  /** The world database's pageTextID; null for a page only a player's client has shown. */
  pageId: number | null;
  /** Two pages share it exactly when they are one book. */
  bookId: string;
  pageNumber: number;
  pageCount: number;
  /** The owning object's or item's name. Not unique: two objects are "A Dusty Tome". */
  title: string;
  ownerKind: OwnerKind | null;
  ownerIds: number[];
  material: number;
  /** The page as the client shows it. */
  text: string;
  /** What is actually sent to ElevenLabs: markup gone, paragraphs flattened. */
  spoken: string;
  /** sha1 of `spoken`. Compared against a take's hash to detect staleness. */
  hash: string;
  /** Store-relative and extension-less, e.g. '1381'. */
  file: string;
  /** False for the 88 pages the game has but nothing can voice, and for a page another
   *  language has not translated. */
  generatable: boolean;
  skipReason: string | null;
  /** What this language has not written; another language's words stand in, marked. */
  missing?: { text: boolean; title: boolean };
  /** The English page, for a translator to work from. Absent when reading English. */
  english?: string;
  /** The owner's English name, likewise. */
  englishTitle?: string;
};

/** The live take for a page, as the explorer needs it. Mirrors the places shape. */
export type Take = {
  version: number;
  file: string;
  textHash: string;
  chars: number;
  credits: number | null;
  durationSec: number | null;
  bytes: number;
  modelId: string | null;
  voiceId: string | null;
  generatedAt: string;
  /** How many takes exist in total. 1 means there is nothing to go back to. */
  takes: number;
};

/**
 * Everything database-backed, passed into the pure search rather than fetched by it. The
 * split lib/places/catalogue.ts makes, and the reason the filtering is testable with no
 * database.
 */
export type SearchContext = {
  takes: Map<string, Take>;
  /**
   * What the lexicon has changed lately, and what somebody has already judged fine. Carried
   * rather than resolved into a set, because the rule needs the page's text as well as its
   * take. See lib/generation/dirty.ts.
   */
  dirt: DirtyContext;
  /** lineId -> how many reports are still open. The count only; the bodies are on /reports. */
  reports: Map<string, number>;
  /**
   * lineId -> who and what made the live take. Absent unless the viewer works in the
   * language: the author is a person's name, and a visitor has no use for it.
   */
  madeBy?: Map<string, MadeBy>;
  /** file -> its live voice-actor recording. Absent for anybody who does not record here. */
  recordings?: Map<string, LiveRecording>;
};

export const EMPTY_CONTEXT: SearchContext = {
  takes: new Map(),
  dirt: NO_DIRT,
  reports: new Map(),
};

/**
 * The corpus is empty, so there is nothing to show.
 *
 * Worth its own type rather than an empty list: between a fresh database and the first
 * import this is the normal state, and a page that says "run the import" is a better
 * answer than one that looks like the game has no books in it.
 */
export class CorpusEmpty extends Error {
  constructor(lang: Lang = BASE_LANG) {
    super(
      lang === BASE_LANG
        ? "book_line holds no English pages -- seed it with: make readables-extract && " +
            "make readables-import (and check DATABASE_URL points at the database you mean)"
        : `book_line holds no ${lang} pages yet`,
    );
    this.name = "CorpusEmpty";
  }
}

/**
 * Whether a thrown thing is that, across the module boundary.
 *
 * By name rather than `instanceof`, for the reason lib/places/catalogue.ts gives: `next dev`
 * re-evaluates modules, so a route can be handed an error built by a different evaluation
 * of this file, and the two classes are not the same constructor. The name survives.
 */
export function isCorpusEmpty(error: unknown): boolean {
  return error instanceof Error && error.name === "CorpusEmpty";
}

/** One memo per language (lib/memo.ts), so switching between two does not rebuild each time. */
const cacheKey = Symbol.for("spoken.readables-catalogue.by-lang");

/**
 * What the corpus's rows are, as one comparable value (lib/stamp.ts).
 *
 * Validated rather than invalidated, exactly as the places catalogue is and for the same
 * reason: this app runs two pm2 workers, so a memo one worker drops after a save is a memo
 * the other keeps serving.
 */
async function stampOf(lang: Lang): Promise<string> {
  const rows = await query<{ stamp: string }>(
    `select ${versionStamp("book_line", `"lang" = $1`)} || '|' ||
            ${versionStamp("book_line", `"lang" = '${BASE_LANG}'`)} || '|' ||
            ${bookPageStamp()} || '|' ||
            ${nameStamp(["item", "gameobject"])} as "stamp"`,
    [lang],
  );
  return rows[0]?.stamp ?? "";
}

/**
 * A page as a narrator would be sent it: its $N, $C and $R spoken as the language's words
 * (player-words.ts) before the pipeline's own rules flatten it, hash it and judge it. The
 * hash is of that same string, so a take and the page it is compared against agree.
 *
 * Judged here rather than read off the row: the extract and the site's own saves wrote a
 * page holding a $N down as `substitution`, which the word now speaks. isGeneratable is the
 * extract's rule, so asking it again changes nothing else.
 */
function voiced(text: string, lang: Lang, title?: string) {
  const said = speakPlayerTokens(text, lang);
  const spoken = title ? spokenWithTitle(speakPlayerTokens(title, lang), said) : spokenText(said);
  // Hashed as sent: the title's line break is the one newline spoken text keeps. Without a
  // title this is textHash(said), so no other page's take moves.
  return { spoken, hash: spokenHash(spoken), ...isGeneratable(said) };
}

/**
 * The title a page is read with: the book's, on its first page only, and only in the
 * language being read -- an English name standing in for an untranslated one is shown,
 * marked, and never said. Adding it changed every first page's hash, which is the point:
 * their takes are stale until they are read again with it.
 */
function spokenTitle(pageNumber: number, title: string | undefined): string | undefined {
  return pageNumber === 1 ? title : undefined;
}

type PageRow = {
  lineId: string;
  pageTextId: number | null;
  bookId: string;
  pageNumber: number;
  pageCount: number;
  ownerKind: OwnerKind | null;
  ownerIds: number[] | null;
  material: number | null;
  text: string | null;
  title: string | null;
  englishText: string | null;
  englishTitle: string | null;
  /** Any language's title, for a page neither this language nor English names. */
  anyTitle: string | null;
};

/**
 * Every page that exists, with this language's words where it has them. Where it has none, the
 * page is still listed -- its place is a fact about the world -- with English, or any language,
 * standing in, marked `missing`, and never voiced.
 *
 * A title is the owner's name in entity_name when the page has an owner, and otherwise the
 * page's own book_line title, as for a page a player's client showed.
 */
async function build(lang: Lang): Promise<BookPage[]> {
  const [rows, names] = await Promise.all([
    query<PageRow>(
      `select p."lineId", p."pageTextId", p."bookId", p."pageNumber",
              count(*) over (partition by p."bookId")::int as "pageCount",
              p."ownerKind", p."ownerIds", p."material",
              l."text", l."title", e."text" as "englishText", e."title" as "englishTitle",
              (select a."title" from "book_line" a
                where a."lineId" = p."lineId" and a."isCurrent" and trim(a."title") <> ''
                order by a."lang" limit 1) as "anyTitle"
         from "book_page" p
         left join "book_line" l on l."lineId" = p."lineId" and l."lang" = $1 and l."isCurrent"
         left join "book_line" e on e."lineId" = p."lineId" and e."lang" = $2 and e."isCurrent"
        where p."aliasOf" is null
        order by p."bookId", p."pageNumber"`,
      [lang, BASE_LANG],
    ),
    query<{ kind: string; entityId: string; name: string }>(
      `select "kind", "entityId", "name" from "entity_name"
        where "lang" = $1 and "kind" in ('item', 'gameobject') and "isCurrent"`,
      [lang],
    ),
  ]);
  if (rows.length === 0) throw new CorpusEmpty(lang);
  const owned = new Map(names.map((row) => [`${row.kind}:${row.entityId}`, row.name]));

  // A page with an owner is titled by the owner's name in this language and by nothing else:
  // book_line's title is the English owner name for an extracted page. A page without an owner
  // takes its book's first page's title, as that page resolves it, so every page of a book reads
  // under one name; only where that page is ownerless and untitled does the page fall back to
  // its own. An empty title is no title.
  const named = (title: string | null | undefined) => (title?.trim() ? title : undefined);
  const ownTitle = (row: PageRow): string | undefined => {
    if (!row.ownerKind) return named(row.title);
    if (lang === BASE_LANG) return named(row.englishTitle);
    const ownerIds = row.ownerIds ?? [];
    return ownerIds.length ? named(owned.get(`${ownerEntityKind(row.ownerKind)}:${ownerIds[0]}`)) : undefined;
  };
  const first = new Map<string, { title: string | undefined; owned: boolean }>();
  for (const row of rows) {
    if (!first.has(row.bookId)) first.set(row.bookId, { title: ownTitle(row), owned: row.ownerKind !== null });
  }

  return rows.map((row) => {
    const ownerIds = row.ownerIds ?? [];
    const book = first.get(row.bookId)!;
    const title = row.ownerKind ? ownTitle(row) : book.owned ? book.title : book.title ?? ownTitle(row);
    const shown = title ?? named(row.englishTitle) ?? named(row.anyTitle) ?? "";
    const base = {
      id: row.lineId,
      key: pageKeyOf(row.lineId),
      pageId: row.pageTextId,
      bookId: row.bookId,
      pageNumber: row.pageNumber,
      pageCount: row.pageCount,
      title: shown,
      ownerKind: row.ownerKind,
      ownerIds,
      material: row.material ?? 0,
      file: fileFor(pageKeyOf(row.lineId)),
      ...(lang !== BASE_LANG && { english: row.englishText ?? "", englishTitle: row.englishTitle ?? "" }),
    };
    if (row.text === null) {
      return {
        ...base,
        text: row.englishText ?? "",
        spoken: "",
        hash: textHash(""),
        generatable: false,
        skipReason: "untranslated",
        missing: { text: true, title: title === undefined },
      };
    }
    return {
      ...base,
      text: row.text,
      ...voiced(row.text, lang, spokenTitle(row.pageNumber, title)),
      ...(title === undefined && { missing: { text: false, title: true } }),
    };
  });
}

export async function catalogue(lang: Lang = BASE_LANG): Promise<BookPage[]> {
  return memoByLang(cacheKey, lang, await stampOf(lang), () => build(lang));
}

/** `seesMadeBy`: whether the viewer works in the language. See SearchContext.madeBy. */
export async function loadContext(
  lang: Lang = BASE_LANG,
  seesMadeBy = false,
): Promise<SearchContext> {
  const [takeRows, reportRows, dirt] = await Promise.all([
    liveTakes("readables", lang),
    // Grouped in the database rather than counted here: resolved rows are the ones that
    // accumulate, and there is no reason to carry them across to drop them. `lineId is not
    // null` excludes a report about the project, which belongs to no line.
    readAs<{ lineId: string; open: number }>(
      lang,
      `select "lineId", count(*)::int as "open"
         from "report"
        where "source" = 'readables' and "status" = 'open' and "lineId" is not null
          and "lang" = $1
        group by "lineId"`,
      [lang],
    ),
    loadDirtyContext("readables", lang),
  ]);

  return {
    takes: new Map(
      takeRows.map((row) => [
        row.lineId,
        {
          version: row.version,
          file: row.file,
          textHash: row.spokenHash ?? "",
          chars: row.characters ?? 0,
          credits: row.credits,
          durationSec: row.durationSec,
          bytes: row.bytes,
          modelId: row.modelId,
          voiceId: row.voiceId,
          generatedAt: row.createdAt.toISOString(),
          takes: row.takes,
        },
      ]),
    ),
    reports: new Map(reportRows.map((row) => [row.lineId, row.open])),
    dirt,
    ...(seesMadeBy && { madeBy: new Map(takeRows.map((row) => [row.lineId, madeByOf(row)])) }),
  };
}

/**
 * Whether a lineId names a page that exists.
 *
 * `report` has no foreign key onto `book_line`, so this is what stands between a typo and a
 * row nothing will ever show or clean up. Every route accepting a lineId from outside calls it.
 */
export async function isKnownLine(lineId: string, lang: Lang = BASE_LANG): Promise<boolean> {
  return (await catalogue(lang)).some((page) => page.id === lineId);
}

/** One page, by the key the addon and the landing URL know it as: '1381' or 'n{uuid}'. */
export async function pageById(key: string, lang: Lang = BASE_LANG): Promise<BookPage | undefined> {
  const keyed = lineIdOfKey(key);
  if (!keyed) return undefined;
  // A minted page folded into a real one is still addressed by its old key, from packs and
  // reports already out.
  const rows = await query<{ aliasOf: string | null }>(
    `select "aliasOf" from "book_page" where "lineId" = $1`,
    [keyed],
  );
  const lineId = rows[0]?.aliasOf ?? keyed;
  return (await catalogue(lang)).find((page) => page.id === lineId);
}

/** The book dropdown's options, derived from the corpus rather than hardcoded. */
export type BookFacet = { bookId: string; title: string; pages: number; ownerKind: OwnerKind | null };

export async function bookFacets(lang: Lang = BASE_LANG): Promise<BookFacet[]> {
  const pages = await catalogue(lang);
  const books = new Map<string, BookFacet>();

  for (const page of pages) {
    const existing = books.get(page.bookId);
    if (existing) {
      existing.pages++;
    } else {
      books.set(page.bookId, {
        bookId: page.bookId,
        title: page.title,
        pages: 1,
        ownerKind: page.ownerKind,
      });
    }
  }

  // By title, then by id: 381 distinct titles cover 404 books, so a stable tiebreak is
  // what keeps two "A Dusty Tome" entries from swapping places between requests.
  return [...books.values()].sort(
    (a, b) => a.title.localeCompare(b.title) || a.bookId.localeCompare(b.bookId, undefined, { numeric: true }),
  );
}

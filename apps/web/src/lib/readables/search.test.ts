import { describe, expect, it } from "vitest";

import { EMPTY_CONTEXT, type BookPage, type SearchContext, type Take } from "./catalogue";
import { matching, decorate, search, stateOf } from "./search";
import { activeFilterCount, filterParams, filtersFromParams } from "./filters";

const page = (over: Partial<BookPage> = {}): BookPage => ({
  id: "b:10",
  pageId: 10,
  key: "10",
  bookId: "10",
  pageNumber: 1,
  pageCount: 1,
  title: "A Dusty Tome",
  ownerKind: "object",
  ownerIds: [179547],
  material: 0,
  text: "A dry account of grain shipments.",
  spoken: "A dry account of grain shipments.",
  hash: "hash-1",
  file: "10",
  generatable: true,
  skipReason: null,
  ...over,
});

const take = (over: Partial<Take> = {}): Take => ({
  version: 1,
  file: "10",
  textHash: "hash-1",
  chars: 10,
  credits: null,
  durationSec: null,
  bytes: 1,
  modelId: null,
  voiceId: null,
  generatedAt: "2026-09-18T00:00:00.000Z",
  takes: 1,
  ...over,
});

const context = (over: Partial<SearchContext> = {}): SearchContext => ({
  ...EMPTY_CONTEXT,
  ...over,
});

describe("stateOf", () => {
  it("is missing with no take", () => {
    expect(stateOf(page(), undefined)).toBe("missing");
  });

  it("is current when the take's hash matches the spoken text", () => {
    expect(stateOf(page(), take())).toBe("current");
  });

  it("is stale when the text has moved since the take", () => {
    expect(stateOf(page(), take({ textHash: "hash-0" }))).toBe("stale");
  });
});

describe("matching", () => {
  const lines = [
    decorate(page(), EMPTY_CONTEXT),
    decorate(
      page({ id: "b:20", pageId: 20, key: "20", bookId: "20", title: "Stalvan's Note", ownerKind: "item", text: "A ledger of debts owed." }),
      EMPTY_CONTEXT,
    ),
  ];

  it("matches on the book's title", () => {
    expect(matching(lines, { q: "dusty" }).map((l) => l.id)).toEqual(["b:10"]);
  });

  it("matches on the page's words", () => {
    expect(matching(lines, { q: "ledger" }).map((l) => l.id)).toEqual(["b:20"]);
  });

  it("a title query does not match the page's words", () => {
    expect(matching(lines, { q: "ledger", field: "title" })).toEqual([]);
  });

  it("filters by owner kind", () => {
    expect(matching(lines, { ownerKind: "item" }).map((l) => l.id)).toEqual(["b:20"]);
  });

  it("filters to one book", () => {
    expect(matching(lines, { bookId: "20" }).map((l) => l.id)).toEqual(["b:20"]);
  });

  it("selects one page by its id, which is how a report links here", () => {
    expect(matching(lines, { line: "b:20" }).map((l) => l.id)).toEqual(["b:20"]);
  });

  it("matches nothing for an id the corpus no longer carries", () => {
    expect(matching(lines, { line: "b:99999" })).toEqual([]);
  });

  it("filters out the pages that cannot be voiced", () => {
    const silent = decorate(page({ id: "b:30", pageId: 30, generatable: false, skipReason: "substitution" }), EMPTY_CONTEXT);
    expect(matching([...lines, silent], { voiceable: true }).map((l) => l.id)).toEqual(["b:10", "b:20"]);
    expect(matching([...lines, silent], { voiceable: false }).map((l) => l.id)).toEqual(["b:30"]);
  });

  it("carries both answers of voiceable through the URL, and counts either as a filter", () => {
    for (const voiceable of [true, false]) {
      expect(filtersFromParams(filterParams({ voiceable })).voiceable).toBe(voiceable);
      expect(activeFilterCount({ voiceable })).toBe(1);
    }
    expect(filtersFromParams(new URLSearchParams()).voiceable).toBeUndefined();
  });

  it("an empty filter set returns everything", () => {
    expect(matching(lines, {})).toHaveLength(2);
  });
});

describe("search", () => {
  const pages = [
    page({ id: "b:12", pageId: 12, key: "12", bookId: "10", pageNumber: 3, pageCount: 3 }),
    page({ id: "b:10", pageId: 10, key: "10", bookId: "10", pageNumber: 1, pageCount: 3 }),
    page({ id: "b:11", pageId: 11, key: "11", bookId: "10", pageNumber: 2, pageCount: 3 }),
  ];

  it("orders pages by book and then by page number, so a book reads in order", () => {
    expect(search(pages, EMPTY_CONTEXT).lines.map((l) => l.pageNumber)).toEqual([1, 2, 3]);
  });

  it("counts every matching line's state, not just the page shown", () => {
    const takes = new Map([["b:10", take()]]);
    const result = search(pages, context({ takes }));
    expect(result.counts).toEqual({ missing: 2, stale: 0, current: 1 });
    expect(result.total).toBe(3);
  });

  it("totals the characters the current filter would bill", () => {
    const result = search(pages, EMPTY_CONTEXT);
    expect(result.totalChars).toBe(pages.reduce((sum, p) => sum + p.spoken.length, 0));
  });

  it("pages through the results", () => {
    const result = search(pages, EMPTY_CONTEXT, {}, 1, 1);
    expect(result.lines.map((l) => l.id)).toEqual(["b:11"]);
    expect(result.total).toBe(3);
  });
});

describe("dirty", () => {
  const spoken = "Of the tauren and their herds.";
  const changed = { grapheme: "Tauren", changedAt: Date.parse("2026-09-19T00:00:00.000Z") };

  const dirt = (acks: Map<string, number> = new Map()) => ({ changes: [changed], acks });

  it("marks a current page whose pronunciation has moved under it", () => {
    const line = decorate(
      page({ spoken }),
      context({ takes: new Map([["b:10", take()]]), dirt: dirt() }),
    );
    expect(line.state).toBe("current");
    expect(line.dirty).toBe(true);
  });

  it("selects and counts them", () => {
    const pages = [page({ spoken }), page({ id: "b:11", pageId: 11, file: "11", spoken: "Quiet." })];
    const result = search(pages, context({ takes: new Map([["b:10", take()]]), dirt: dirt() }), {
      dirty: true,
    });
    expect(result.lines.map((l) => l.id)).toEqual(["b:10"]);
    expect(result.dirty).toBe(1);
  });

  it("is clean once somebody has said so", () => {
    const acked = context({
      takes: new Map([["b:10", take()]]),
      dirt: dirt(new Map([["10", Date.now()]])),
    });
    expect(decorate(page({ spoken }), acked).dirty).toBe(false);
  });

  it("says nothing about a page with no audio", () => {
    expect(decorate(page({ spoken }), context({ dirt: dirt() })).dirty).toBe(false);
  });
});

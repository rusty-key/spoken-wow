import { describe, expect, it } from "vitest";

import { bookRuns } from "./BookList";
import type { ResultLine } from "@/lib/readables/search";

const line = (id: string, bookId: string, pageNumber: number, pageCount: number): ResultLine =>
  ({
    id,
    pageId: Number(id.slice(2)),
    key: id.slice(2),
    bookId,
    pageNumber,
    pageCount,
    title: "A Book",
    ownerKind: "item",
    ownerIds: [1],
    material: 1,
    text: "…",
    spoken: "…",
    chars: 1,
    file: id.slice(2),
    generatable: true,
    skipReason: null,
    state: "missing",
    take: null,
    reportsOpen: 0,
  }) as ResultLine;

describe("bookRuns", () => {
  it("spans every row a book occupies", () => {
    const rows = [line("b:1", "1", 1, 3), line("b:2", "1", 2, 3), line("b:3", "1", 3, 3)];
    expect(bookRuns(rows)).toEqual(new Map([["b:1", 3]]));
  });

  it("starts a new span per book", () => {
    const rows = [line("b:1", "1", 1, 2), line("b:2", "1", 2, 2), line("b:9", "9", 1, 1)];
    expect(bookRuns(rows)).toEqual(
      new Map([
        ["b:1", 2],
        ["b:9", 1],
      ]),
    );
  });

  it("counts the rows shown, not the book's page count", () => {
    // A filter matching three pages of a twenty-page journal. A span of 20 here would push
    // every following row one column to the right.
    const rows = [line("b:5", "5", 4, 20), line("b:6", "5", 9, 20)];
    expect(bookRuns(rows).get("b:5")).toBe(2);
  });

  it("spans only the part of a book on this page of results", () => {
    // The tail of a book that began on the previous page: its first row here still carries
    // the name, because there is no header row above it to carry it instead.
    const rows = [line("b:18", "5", 18, 20), line("b:19", "5", 19, 20), line("b:1", "7", 1, 1)];
    expect(bookRuns(rows)).toEqual(
      new Map([
        ["b:18", 2],
        ["b:1", 1],
      ]),
    );
  });

  it("is empty for no rows", () => {
    expect(bookRuns([])).toEqual(new Map());
  });
});

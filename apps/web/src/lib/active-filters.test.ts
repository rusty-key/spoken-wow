import { describe, expect, it } from "vitest";

import { activeFilterCount } from "./active-filters";

describe("counting what is in force", () => {
  it("counts nothing on an untouched explorer", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ q: "", filter: "any" })).toBe(0);
  });

  it("does not count whitespace as a query", () => {
    expect(activeFilterCount({ q: "   " })).toBe(0);
  });

  it("counts the query, which narrows like the rest", () => {
    expect(activeFilterCount({ q: "dughan" })).toBe(1);
  });

  it("counts the scope only when there is a query for it to scope", () => {
    // On its own it says where a query is matched, and there is no query to match.
    expect(activeFilterCount({ filter: "text" })).toBe(0);
    expect(activeFilterCount({ q: "dughan", filter: "text" })).toBe(2);
  });

  it("counts each narrowing filter once", () => {
    expect(activeFilterCount({ race: "human", gender: "male", voice: "human-male-official" })).toBe(3);
  });

  it("counts a zone", () => {
    expect(activeFilterCount({ zone: 1411 })).toBe(1);
  });

  it("counts the booleans only when they are true", () => {
    expect(activeFilterCount({ overridden: false })).toBe(0);
    expect(activeFilterCount({ ignored: false, overridden: true })).toBe(1);
    expect(activeFilterCount({ state: "missing", overridden: true })).toBe(2);
    // Ignored counts: it changes which corpus the results came from, so a "clear all" that
    // left it in force would restore a different search than it claims to.
    expect(activeFilterCount({ ignored: true })).toBe(1);
  });

  it("counts the audio state, whichever it is", () => {
    expect(activeFilterCount({ state: "stale" })).toBe(1);
    expect(activeFilterCount({ state: "current" })).toBe(1);
    expect(activeFilterCount({ state: undefined })).toBe(0);
  });

  it("counts narration, which narrows", () => {
    expect(activeFilterCount({ narration: true })).toBe(1);
    expect(activeFilterCount({ narration: false })).toBe(0);
  });

  it("ignores showing progress text, which widens rather than narrows", () => {
    // Progress is hidden by default, so asking for it back is not a filter on the results -
    // and counting it would put "1 filter active" on a page nobody has filtered.
    expect(activeFilterCount({ includeProgress: true })).toBe(0);
    expect(activeFilterCount({ includeProgress: false })).toBe(0);
  });

  it("counts a line deep-link, which narrows harder than anything else", () => {
    expect(activeFilterCount({ line: "q:33:accept" })).toBe(1);
  });
});

describe("counting the generated-on bounds", () => {
  it("counts each end of the range", () => {
    expect(activeFilterCount({ generatedAfter: "2026-07-01" })).toBe(1);
    expect(activeFilterCount({ generatedBefore: "2026-07-01" })).toBe(1);
  });

  it("counts both ends when a range is bounded twice", () => {
    expect(
      activeFilterCount({ generatedAfter: "2026-07-01", generatedBefore: "2026-07-31" }),
    ).toBe(2);
  });

  it("adds them to whatever else is in force", () => {
    expect(activeFilterCount({ race: "human", generatedAfter: "2026-07-01" })).toBe(2);
  });
});

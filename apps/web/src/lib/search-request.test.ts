/**
 * The query string the explorer writes and the two search endpoints read.
 *
 * Worth its own test for the reason links.test.ts exists: a param one side writes and the
 * other does not read produces an unfiltered corpus with a 200 and no error anywhere.
 */
import { describe, expect, it } from "vitest";

import { filtersFromParams } from "./search-request";

describe("filtersFromParams", () => {
  it("reads the line id a report links with", async () => {
    expect((await filtersFromParams(new URLSearchParams("line=q:374:accept"), "enUS")).line).toBe(
      "q:374:accept",
    );
  });

  it("leaves the line filter out when the param is absent or empty", async () => {
    expect((await filtersFromParams(new URLSearchParams(""), "enUS")).line).toBeUndefined();
    expect((await filtersFromParams(new URLSearchParams("line="), "enUS")).line).toBeUndefined();
  });

  it("reads the reported-only filter the explorer writes as fb=open", async () => {
    expect((await filtersFromParams(new URLSearchParams("fb=open"), "enUS")).reports).toBe("open");
    expect((await filtersFromParams(new URLSearchParams("fb=closed"), "enUS")).reports).toBeUndefined();
  });

  it("reads several sources, comma-separated, and drops the ones that are not sources", async () => {
    expect((await filtersFromParams(new URLSearchParams("source=gossip,accept"), "enUS")).source).toEqual(["accept", "gossip"]);
    expect((await filtersFromParams(new URLSearchParams("source=gossip,zones"), "enUS")).source).toEqual(["gossip"]);
    expect((await filtersFromParams(new URLSearchParams("source=zones"), "enUS")).source).toBeUndefined();
  });

  it("reads the follow-up source by its value, not by the label the dropdown shows", async () => {
    // SOURCE_LABELS spells it "follow-up" for people; the URL carries the corpus value, and a
    // hyphenated one would fall outside SOURCES and silently unfilter the search.
    expect((await filtersFromParams(new URLSearchParams("source=followup"), "enUS")).source).toEqual([
      "followup",
    ]);
    expect(
      (await filtersFromParams(new URLSearchParams("source=follow-up"), "enUS")).source,
    ).toBeUndefined();
  });
});

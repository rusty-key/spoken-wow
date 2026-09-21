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
    expect((await filtersFromParams(new URLSearchParams("line=q:374:accept"))).line).toBe(
      "q:374:accept",
    );
  });

  it("leaves the line filter out when the param is absent or empty", async () => {
    expect((await filtersFromParams(new URLSearchParams(""))).line).toBeUndefined();
    expect((await filtersFromParams(new URLSearchParams("line="))).line).toBeUndefined();
  });

  it("reads the reported-only filter the explorer writes as fb=open", async () => {
    expect((await filtersFromParams(new URLSearchParams("fb=open"))).reports).toBe("open");
    expect((await filtersFromParams(new URLSearchParams("fb=closed"))).reports).toBeUndefined();
  });
});

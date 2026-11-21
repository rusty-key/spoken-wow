import { describe, expect, it } from "vitest";

import { corpusLookup } from "./existing";

describe("corpusLookup", () => {
  it("answers null for readables, whose key is a checksum naming no page", () => {
    expect(corpusLookup("readables", "261")).toBe(null);
  });

  it("splits a places key on its first colon, slugging the rest", () => {
    expect(corpusLookup("places", "1537:A Nook With No Lore")).toEqual({
      source: "places",
      mapID: 1537,
      slug: "a-nook-with-no-lore",
    });
  });

  it("keeps a colon inside the subzone name out of the split", () => {
    expect(corpusLookup("places", "1537:North: The Nook")).toEqual({
      source: "places",
      mapID: 1537,
      slug: "north-the-nook",
    });
  });

  it("refuses a places key whose map half is not digits", () => {
    expect(corpusLookup("places", "npc:12345")).toBe(null);
  });

  it("reads a colon-less places key as the zone's own lore, not a subzone", () => {
    // checkEnvelope now emits a bare mapID for the open part of a zone (no subzone); this key
    // has to resolve to the zone-level entry -- file "{mapID}/zone" in naming.mjs -- rather
    // than being treated as malformed the way a real subzone split would be.
    expect(corpusLookup("places", "1537")).toEqual({ source: "places", mapID: 1537, slug: "zone" });
  });

  it("refuses a bare places key that is not digits", () => {
    expect(corpusLookup("places", "npc")).toBe(null);
  });

  it("answers null for quests, which has no corpus target to resolve", () => {
    expect(corpusLookup("quests", "9123:accept")).toBe(null);
  });

  /**
   * The reviewer's exact case: a hand-rolled canonicaliser slugged "The Underbog" to
   * "the-underbog", disagreeing with the corpus's "underbog" and turning a real match into a
   * false "missing". If this ever gets re-inlined instead of going through places/tools.ts's
   * `normaliseKey`/`slugFor` bridge, this is the assertion that should go red first.
   */
  it("drops a leading 'The' the way the corpus's own normaliseKey does", () => {
    expect(corpusLookup("places", "1:The Underbog")).toEqual({
      source: "places",
      mapID: 1,
      slug: "underbog",
    });
  });

  it("drops a leading 'The' from a multi-word subzone too", () => {
    expect(corpusLookup("places", "1:The Cape of Stranglethorn")).toEqual({
      source: "places",
      mapID: 1,
      slug: "cape-of-stranglethorn",
    });
  });
});

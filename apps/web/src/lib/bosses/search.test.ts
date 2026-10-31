/**
 * No database: everything database-backed arrives in the SearchContext.
 *
 * A boss with no story in the language is the case places never has: there is no English
 * standing in, so the row has no text to show, voice or call stale.
 */
import { describe, expect, it } from "vitest";

import type { BossEntry, SearchContext, Take } from "./catalogue";
import { EMPTY_CONTEXT } from "./catalogue";
import { SHORT_LINE, filterParams, filtersFromParams } from "./filters";

import { matching, search, stateOf } from "./search";

function entry(overrides: Partial<BossEntry> = {}): BossEntry {
  const spoken = "x".repeat(SHORT_LINE + 10);
  return {
    id: "boss:36:edwin vancleef",
    bossId: 639,
    map: 36,
    key: "edwin vancleef",
    name: "Edwin VanCleef",
    instanceName: "Deadmines",
    kind: "dungeon",
    zone: 40,
    encounterIds: [639],
    creatureId: 639,
    text: spoken,
    source: "wiki",
    spoken,
    hash: "hash-of-the-current-text",
    file: "36/edwin-vancleef",
    ...overrides,
  };
}

const unwritten = (overrides: Partial<BossEntry> = {}) =>
  entry({ text: null, spoken: null, hash: null, source: null, ...overrides });

function take(overrides: Partial<Take> = {}): Take {
  return {
    version: 1,
    file: "36/edwin-vancleef",
    textHash: "hash-of-the-current-text",
    chars: 100,
    credits: 60,
    durationSec: 10,
    bytes: 1000,
    modelId: "eleven_v3",
    voiceId: "v",
    generatedAt: "2026-08-09T12:00:00.000Z",
    takes: 1,
    ...overrides,
  };
}

function context(overrides: Partial<SearchContext> = {}): SearchContext {
  return { ...EMPTY_CONTEXT, ...overrides };
}

describe("stateOf", () => {
  it("is missing with no take, current when the hashes match, stale when they differ", () => {
    expect(stateOf(entry(), undefined)).toBe("missing");
    expect(stateOf(entry(), take())).toBe("current");
    expect(stateOf(entry(), take({ textHash: "older" }))).toBe("stale");
  });

  it("is missing for a boss with no story in the language", () => {
    expect(stateOf(unwritten(), undefined)).toBe("missing");
  });

  it("is stale for a take whose story is gone from the language", () => {
    expect(stateOf(unwritten(), take())).toBe("stale");
  });
});

describe("search", () => {
  it("shows a boss with no story as unwritten, with nothing to speak", () => {
    const [line] = search([unwritten()], context()).lines;
    expect(line).toMatchObject({ text: null, spoken: null, chars: 0, written: false, short: false });
  });

  it("carries the map, encounter ids and creature id the row shows", () => {
    const [line] = search([entry({ encounterIds: [639, 640], creatureId: null })], context()).lines;
    expect(line).toMatchObject({ mapID: 36, encounterIds: [639, 640], creatureId: null });
  });

  it("carries whether the language has its own name, only off English", () => {
    const [german] = search([entry({ nameMissing: true, englishName: "Edwin VanCleef" })], context()).lines;
    expect(german).toMatchObject({ nameMissing: true, englishName: "Edwin VanCleef" });
    const [english] = search([entry()], context()).lines;
    expect(english).not.toHaveProperty("nameMissing");
  });

  it("keeps the catalogue's order: instance position, then boss position", () => {
    const entries = [
      entry({ id: "boss:36:z", name: "Zed", map: 36, instanceName: "Deadmines" }),
      entry({ id: "boss:36:a", name: "Abe", map: 36, instanceName: "Deadmines" }),
      entry({ id: "boss:33:m", name: "Mid", map: 33, instanceName: "Shadowfang Keep" }),
    ];
    expect(search(entries, context()).lines.map((l) => l.id)).toEqual(["boss:36:z", "boss:36:a", "boss:33:m"]);
  });

  it("counts states and pages", () => {
    const entries = [entry({ id: "boss:36:a" }), unwritten({ id: "boss:36:b" })];
    const result = search(entries, context({ takes: new Map([["boss:36:a", take()]]) }), {}, 1, 1);
    expect(result.counts).toEqual({ missing: 1, stale: 0, current: 1 });
    expect(result.total).toBe(2);
    expect(result.lines.map((l) => l.id)).toEqual(["boss:36:b"]);
  });
});

describe("matching", () => {
  const lines = search(
    [
      entry({ id: "boss:36:a", name: "Edwin VanCleef", instanceName: "Deadmines", text: "Defias leader" }),
      unwritten({ id: "boss:33:b", map: 33, name: "Arugal", instanceName: "Shadowfang Keep" }),
    ],
    context(),
  ).lines;

  it("matches the query against name, instance and text by field", () => {
    expect(matching(lines, { q: "deadmines", field: "instance" }).map((l) => l.id)).toEqual(["boss:36:a"]);
    expect(matching(lines, { q: "arugal", field: "name" }).map((l) => l.id)).toEqual(["boss:33:b"]);
    expect(matching(lines, { q: "defias", field: "text" }).map((l) => l.id)).toEqual(["boss:36:a"]);
    expect(matching(lines, { q: "shadowfang" }).map((l) => l.id)).toEqual(["boss:33:b"]);
    // An unwritten story matches no text query rather than throwing on null.
    expect(matching(lines, { q: "a", field: "text" }).map((l) => l.id)).toEqual(["boss:36:a"]);
  });

  it("selects one instance by its map", () => {
    expect(matching(lines, { mapID: 33 }).map((l) => l.id)).toEqual(["boss:33:b"]);
  });
});

describe("filters", () => {
  it("round-trips through the query string", () => {
    const filters = { q: "edwin", field: "instance" as const, mapID: 36, state: "stale" as const };
    expect(filtersFromParams(filterParams(filters))).toMatchObject(filters);
  });

  it("drops values outside the closed sets", () => {
    const parsed = filtersFromParams(new URLSearchParams("field=zone&state=bogus&instance=x"));
    expect(parsed.field).toBeUndefined();
    expect(parsed.state).toBeUndefined();
    expect(parsed.mapID).toBeUndefined();
  });
});

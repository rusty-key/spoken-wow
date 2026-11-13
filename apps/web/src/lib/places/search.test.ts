/**
 * No database and no filesystem, which is the point of the SearchContext split: everything
 * database-backed is passed in, so the filtering is a pure function and can be tested as
 * one.
 *
 * The state definitions are what these are really about. `missing`, `stale` and `current`
 * have to mean exactly what the CLI's --missing and --stale select, because the explorer's
 * whole claim is that it can tell you what needs regenerating. If the two ever disagree,
 * somebody spends credits on the wrong lines.
 */
import { describe, expect, it } from "vitest";

import type { CatalogueEntry, SearchContext, Take } from "./catalogue";
import { EMPTY_CONTEXT } from "./catalogue";
import { SHORT_LINE } from "./filters";
import { madeByOf } from "@/lib/takes/made-by";

import { matching, search, stateOf } from "./search";

function entry(overrides: Partial<CatalogueEntry> = {}): CatalogueEntry {
  const spoken = overrides.spoken ?? "x".repeat(SHORT_LINE + 10);
  return {
    id: "z:1411",
    kind: "zone",
    mapID: 1411,
    key: null,
    name: "Durotar",
    zoneName: "Durotar",
    full: spoken,
    short: "a summary",
    spoken,
    hash: "hash-of-the-current-text",
    file: "1411/zone",
    ...overrides,
  };
}

function take(overrides: Partial<Take> = {}): Take {
  return {
    version: 1,
    file: "1411/zone",
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
  it("is missing when nothing has been generated", () => {
    expect(stateOf(entry(), undefined)).toBe("missing");
  });

  it("is current when the take was cut from this exact spoken text", () => {
    expect(stateOf(entry(), take())).toBe("current");
  });

  /**
   * The hash is of the SPOKEN text, so this is the same answer for a rewritten line and
   * for a pronunciation rule that changed how an unchanged line is read aloud. Both mean
   * the audio on disk no longer matches what the line says.
   */
  it("is stale when the spoken text has moved since the take", () => {
    expect(stateOf(entry(), take({ textHash: "the-hash-before-the-edit" }))).toBe("stale");
  });
});

describe("matching", () => {
  const lines = search(
    [
      entry({ id: "z:1411", name: "Durotar", zoneName: "Durotar", kind: "zone" }),
      entry({
        id: "s:1411:razor hill",
        kind: "subzone",
        key: "razor hill",
        name: "Razor Hill",
        zoneName: "Durotar",
        file: "1411/razor-hill",
        spoken: "a short one",
        full: "a short one",
      }),
      entry({ id: "z:12", name: "Elwynn Forest", zoneName: "Elwynn Forest", mapID: 12 }),
    ],
    context(),
  ).lines;

  it("matches a name, a zone or the text depending on the field", () => {
    expect(matching(lines, { q: "razor" }).map((l) => l.id)).toEqual(["s:1411:razor hill"]);
    expect(matching(lines, { q: "durotar", field: "zone" })).toHaveLength(2);
    expect(matching(lines, { q: "durotar", field: "text" })).toHaveLength(0);
  });

  it("selects a zone and its subzones together", () => {
    expect(matching(lines, { mapID: 1411 })).toHaveLength(2);
  });

  it("knows a short line from a long one", () => {
    expect(matching(lines, { short: true }).map((l) => l.id)).toEqual(["s:1411:razor hill"]);
  });

  it("selects one line by its id, which is how a report links here", () => {
    expect(matching(lines, { line: "s:1411:razor hill" }).map((l) => l.id)).toEqual([
      "s:1411:razor hill",
    ]);
  });

  it("matches nothing for an id the catalogue no longer carries", () => {
    expect(matching(lines, { line: "z:99999" })).toHaveLength(0);
  });

  /** A hand-edited URL should narrow nothing rather than match nothing. */
  it("ignores a filter that selects a value no line has", () => {
    expect(matching(lines, { mapID: 99999 })).toHaveLength(0);
  });
});

describe("reports", () => {
  const entries = [entry({ id: "z:1" }), entry({ id: "z:2" }), entry({ id: "z:3" })];

  /** The one worklist now: what a listener complained about and nobody has answered. */
  it("selects lines carrying an unresolved report", () => {
    const lines = search(entries, context({ reports: new Map([["z:2", 3]]) })).lines;

    expect(matching(lines, { reports: "open" }).map((l) => l.id)).toEqual(["z:2"]);
    expect(lines.find((l) => l.id === "z:2")!.reportsOpen).toBe(3);
  });
});

describe("generation dates", () => {
  const entries = [entry({ id: "z:1" }), entry({ id: "z:2" })];
  const takes = new Map([
    ["z:1", take({ generatedAt: "2026-08-01T09:00:00.000Z" })],
    ["z:2", take({ generatedAt: "2026-08-03T09:00:00.000Z" })],
  ]);

  /** "Before the 3rd" must not include a clip cut at 09:00 on the 3rd. */
  it("excludes the named day's own generations from `before`", () => {
    const lines = search(entries, context({ takes })).lines;
    expect(matching(lines, { generatedBefore: "2026-08-03" }).map((l) => l.id)).toEqual(["z:1"]);
  });

  it("includes the named day's own generations in `after`", () => {
    const lines = search(entries, context({ takes })).lines;
    expect(matching(lines, { generatedAfter: "2026-08-03" }).map((l) => l.id)).toEqual(["z:2"]);
  });

  /** A date filter is a claim about a take, so a line with none cannot satisfy it. */
  it("drops lines that have never been generated", () => {
    const lines = search(entries, context()).lines;
    expect(matching(lines, { generatedAfter: "2020-01-01" })).toHaveLength(0);
  });
});

describe("search", () => {
  const entries = Array.from({ length: 5 }, (_, i) =>
    entry({ id: `z:${i}`, mapID: i, name: `Zone ${i}`, zoneName: `Zone ${i}` }),
  );

  it("counts and totals across every page, not just the one returned", () => {
    const result = search(entries, context(), {}, 0, 2);

    expect(result.lines).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.counts.missing).toBe(5);
    expect(result.totalChars).toBe(entries.reduce((n, e) => n + e.spoken.length, 0));
  });

  /**
   * Paging a list whose order can shift drops and repeats rows between pages, so the
   * order is total: zone line first within a zone, then subzones by name, then the id.
   */
  it("pages a stable order", () => {
    const first = search(entries, context(), {}, 0, 2).lines.map((l) => l.id);
    const second = search(entries, context(), {}, 2, 2).lines.map((l) => l.id);

    expect(new Set([...first, ...second]).size).toBe(4);
    expect(search(entries, context(), {}, 0, 2).lines.map((l) => l.id)).toEqual(first);
  });

  it("puts a zone's own line before its subzones", () => {
    const result = search(
      [
        entry({ id: "s:1411:razor hill", kind: "subzone", name: "Razor Hill", zoneName: "Durotar" }),
        entry({ id: "z:1411", kind: "zone", name: "Durotar", zoneName: "Durotar" }),
      ],
      context(),
    );

    expect(result.lines.map((l) => l.id)).toEqual(["z:1411", "s:1411:razor hill"]);
  });
});

describe("dirty", () => {
  const spoken = "The tauren of Durotar greet you.";
  const changed = { grapheme: "Tauren", changedAt: Date.parse("2026-08-10T00:00:00.000Z") };

  function dirtyContext() {
    return context({
      takes: new Map([["z:1411", take()]]),
      dirt: { changes: [changed], acks: new Map() },
    });
  }

  it("marks a current take whose pronunciation has moved under it", () => {
    // The text has not changed, so the take is `current` - which is exactly why this needed
    // a mark of its own rather than a fourth state.
    const [line] = search([entry({ spoken })], dirtyContext()).lines;
    expect(line.state).toBe("current");
    expect(line.dirty).toBe(true);
  });

  it("selects and counts them", () => {
    const entries = [
      entry({ spoken }),
      entry({ id: "s:1411:razor hill", kind: "subzone", file: "1411/razor-hill", spoken: "Quiet." }),
    ];
    const result = search(entries, dirtyContext(), { dirty: true });
    expect(result.lines.map((l) => l.id)).toEqual(["z:1411"]);
    expect(result.dirty).toBe(1);
  });

  it("is clean once somebody has said so", () => {
    const acked = context({
      takes: new Map([["z:1411", take()]]),
      dirt: { changes: [changed], acks: new Map([["1411/zone", Date.now()]]) },
    });
    expect(search([entry({ spoken })], acked).lines[0].dirty).toBe(false);
  });

  it("says nothing about a line with no audio", () => {
    const noTake = context({ dirt: { changes: [changed], acks: new Map() } });
    expect(search([entry({ spoken })], noTake).lines[0].dirty).toBe(false);
  });
});

describe("made by", () => {
  const entries = [entry({ id: "z:1" }), entry({ id: "z:2" }), entry({ id: "z:3" })];
  const madeBy = new Map([
    ["z:1", madeByOf({ provider: "fish", modelId: "s2.1-pro-free", createdBy: "u1", createdByName: "Amy", createdAt: new Date("2026-10-01T12:00:00Z") })],
    ["z:2", madeByOf({ provider: "elevenlabs", modelId: "eleven_v3", createdBy: null, createdByName: null, createdAt: new Date("2026-10-01T12:00:00Z") })],
  ]);

  it("narrows by model and author, and offers every one the takes hold", () => {
    const result = search(entries, context({ madeBy }), { model: "fish:2.1-pro-free" });
    expect(result.lines.map((line) => line.id)).toEqual(["z:1"]);
    expect(result.lines[0].madeBy?.authorName).toBe("Amy");
    expect(result.madeBy?.models).toEqual(["eleven:v3", "fish:2.1-pro-free"]);
    expect(search(entries, context({ madeBy }), { author: "u1" }).total).toBe(1);
  });

  /** What the route hands a visitor: no map, so no names on the rows and no facets. */
  it("says nothing about who made what without the map", () => {
    const result = search(entries, context());
    expect(result.madeBy).toBeUndefined();
    expect(result.lines.every((line) => line.madeBy === null)).toBe(true);
  });
});

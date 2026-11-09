import { describe, expect, it, vi } from "vitest";

import type { BookMatchResult } from "./book-match";
import { bookFor, idOnlyResolution, labelOf, npcSummaryFrom, packHeard, questFor, resolveMissing } from "./triage";

describe("packHeard", () => {
  it("names the packs' language when it is not the client's", () => {
    expect(packHeard({ locale: "deDE", meta: { pack: "enUS" } })).toBe("enUS");
  });

  it("says nothing when the player hears their client's language, or the envelope has no pack", () => {
    expect(packHeard({ locale: "deDE", meta: { pack: "deDE" } })).toBeNull();
    expect(packHeard({ locale: "deDE", meta: {} })).toBeNull();
  });
});

describe("questFor", () => {
  it("reads the title and quest id off a quest-moment envelope", async () => {
    // A real row from the local database (id 518): meta carries both, so the Quest column has
    // something to show and a link to build.
    expect(
      questFor({ source: "quests", meta: { quest: "76156", title: "Stalk With The Earthmother", event: "progress" } }),
    ).toEqual({ title: "Stalk With The Earthmother", questId: 76156, stage: "progress" });
  });

  it("leaves the stage null for an event the addon never sends", async () => {
    expect(
      questFor({ source: "quests", meta: { quest: "76156", title: "Stalk With The Earthmother", event: "greeting" } }),
    ).toEqual({ title: "Stalk With The Earthmother", questId: 76156, stage: null });
  });

  // checkEnvelope's other quests-source shape: an `npc:<id>` key, carrying neither field.
  // "Gossip" rather than an empty cell, so it never reads as "we lost the quest".
  it("is 'gossip' for a quests-source envelope with neither field", async () => {
    expect(questFor({ source: "quests", meta: { npc: "205729 Boarton Shadetotem" } })).toBe("gossip");
  });

  it("is null for a source that has no quest concept at all", async () => {
    expect(questFor({ source: "places", meta: { map: "1519" } })).toBe(null);
    expect(questFor({ source: "readables", meta: { page: "42" } })).toBe(null);
  });

  it("is 'gossip' rather than a half-answer when only one of the two fields is present", async () => {
    // Not a shape checkEnvelope itself produces, but meta is stored text a client wrote --
    // treating a partial pair as gossip (empty, not a false quest link) is the safer read of
    // data this table's own docstring already calls out as not to be trusted blindly.
    expect(questFor({ source: "quests", meta: { quest: "76156" } })).toBe("gossip");
    expect(questFor({ source: "quests", meta: { title: "Stalk With The Earthmother" } })).toBe("gossip");
  });
});

function resolution(overrides: Partial<Parameters<typeof npcSummaryFrom>[1] & object> = {}) {
  return {
    npcKind: "creature" as const,
    npcId: 288,
    npcName: "Jitters",
    race: "human",
    gender: "male",
    flavor: "standard",
    provenance: "corpus" as const,
    confirmed: true,
    doubtful: false,
    modelFileId: null,
    sex: null,
    creatureType: null,
    build: null,
    note: null,
    resolvedBy: null,
    updatedAt: "now",
    ...overrides,
  };
}

describe("npcSummaryFrom", () => {
  // The exact hardest case this table was designed against: the three real rows in the local
  // database, none of which carry `kind` at all (filed before the addon reported it).
  it("is fully unresolved for a kind-less observation with no resolution", async () => {
    expect(
      await npcSummaryFrom({ npcKind: null, npcId: 205729, npcName: "Boarton Shadetotem" }, undefined),
    ).toEqual({
      npcKind: null,
      npcId: 205729,
      npcName: "Boarton Shadetotem",
      race: null,
      gender: null,
      flavor: null,
      provenance: "none",
      confirmed: false,
      doubtful: false,
      flavorOptions: [],
      conflict: [],
    });
  });

  it("carries a conflict's answers without their bookkeeping", async () => {
    const other = resolution({ npcKind: "gameobject", race: "tauren", provenance: "moderator" });
    expect(
      (await npcSummaryFrom({ npcKind: null, npcId: 288, npcName: "Jitters" }, undefined, [other, resolution()])).conflict,
    ).toEqual([
      { npcKind: "gameobject", race: "tauren", gender: "male", flavor: "standard", provenance: "moderator", doubtful: false },
      { npcKind: "creature", race: "human", gender: "male", flavor: "standard", provenance: "corpus", doubtful: false },
    ]);
  });

  it("is fully unresolved for a known-kind observation with no resolution either", async () => {
    expect(
      await npcSummaryFrom({ npcKind: "creature", npcId: 999, npcName: "Some Guard" }, undefined),
    ).toMatchObject({ npcKind: "creature", provenance: "none", confirmed: false, flavorOptions: [] });
  });

  it("carries the resolution's own answer, and derives its flavor options from it", async () => {
    const summary = await npcSummaryFrom(
      { npcKind: "creature", npcId: 288, npcName: "Jitters" },
      resolution(),
    );
    expect(summary).toMatchObject({ race: "human", gender: "male", flavor: "standard", provenance: "corpus" });
    // human-male: pinned against the real corpus, the same way corpus.test.ts pins flavorsFor.
    expect(summary.flavorOptions).toContain("standard");
  });

  // A resolution can only exist at all if some envelope -- this one, or an earlier one for the
  // same NPC -- carried a kind; that makes it strictly more informed than the current envelope's
  // own kind, which may be null.
  it("prefers the resolution's kind over a kind-less observation's", async () => {
    const summary = await npcSummaryFrom(
      { npcKind: null, npcId: 205729, npcName: "Boarton Shadetotem" },
      resolution({ npcKind: "creature", npcId: 205729, race: "tauren", gender: "male", flavor: "warrior", provenance: "client", confirmed: false }),
    );
    expect(summary.npcKind).toBe("creature");
  });

  // The resolution is shared across languages and named in English; the envelope's name is what
  // this row's own client called the NPC.
  it("keeps the envelope's own, localised name over the resolution's", async () => {
    const summary = await npcSummaryFrom(
      { npcKind: "creature", npcId: 288, npcName: "Nervioso" },
      resolution(),
    );
    expect(summary.npcName).toBe("Nervioso");
  });

  it("falls back to the resolution's name when the envelope named none", async () => {
    const summary = await npcSummaryFrom({ npcKind: "creature", npcId: 288, npcName: null }, resolution());
    expect(summary.npcName).toBe("Jitters");
  });

  it("has no flavor options when the resolution names no race or gender", async () => {
    const summary = await npcSummaryFrom(
      { npcKind: "creature", npcId: 1, npcName: "A Narrator" },
      resolution({ race: null, gender: null, flavor: null, provenance: "none", confirmed: false }),
    );
    expect(summary.flavorOptions).toEqual([]);
  });
});

describe("idOnlyResolution", () => {
  it("uses a kind-less contribution's one matching row", () => {
    expect(idOnlyResolution([resolution()])).toEqual({ resolution: resolution(), conflict: [] });
  });

  it("uses the answer two kinds agree on, the moderator's own row first", () => {
    const moderator = resolution({ npcKind: "gameobject", provenance: "moderator" });
    expect(idOnlyResolution([resolution(), moderator])).toEqual({ resolution: moderator, conflict: [] });
  });

  it("ignores a row that knows nothing when the other one answers", () => {
    const nothing = resolution({ npcKind: "gameobject", race: null, gender: null, flavor: null, provenance: "none", confirmed: false });
    expect(idOnlyResolution([nothing, resolution()])).toEqual({ resolution: resolution(), conflict: [] });
  });

  // The moderator's answer is used unless another kind disagrees -- then it is theirs to settle.
  it("reports a conflict, best-ranked first, when the two kinds disagree", () => {
    const moderator = resolution({ npcKind: "gameobject", race: "tauren", provenance: "moderator" });
    expect(idOnlyResolution([resolution(), moderator])).toEqual({
      resolution: undefined,
      conflict: [moderator, resolution()],
    });
  });

  it("gets nothing for an id nobody has resolved", () => {
    expect(idOnlyResolution(undefined)).toEqual({ resolution: undefined, conflict: [] });
    expect(idOnlyResolution([])).toEqual({ resolution: undefined, conflict: [] });
  });
});

describe("resolveMissing", () => {
  // The failure this exists to survive: a DB blip or pool exhaustion on one write must not take
  // the whole queue down with it. Same principle the intake route already follows for the same
  // call (api/contributions/route.ts: "A failure here must not fail the contribution").
  it("keeps every other key's answer when one resolver call throws", async () => {
    const toResolve = new Map([
      ["creature:1", "a"],
      ["creature:2", "b"],
      ["creature:3", "c"],
    ]);
    const resolveOne = vi.fn(async (value: string) => {
      if (value === "b") throw new Error("pool exhausted");
      return resolution({ npcName: value });
    });

    const resolved = await resolveMissing(toResolve, resolveOne);

    expect(resolved.get("creature:1")).toMatchObject({ npcName: "a" });
    expect(resolved.has("creature:2")).toBe(false);
    expect(resolved.get("creature:3")).toMatchObject({ npcName: "c" });
  });

  it("leaves a key out entirely when its resolver answers null", async () => {
    const toResolve = new Map([["creature:1", "a"]]);
    const resolved = await resolveMissing(toResolve, async () => null);
    expect(resolved.size).toBe(0);
  });

  it("is empty for nothing to resolve", async () => {
    const resolved = await resolveMissing(new Map(), async () => resolution());
    expect(resolved.size).toBe(0);
  });
});

describe("labelOf", () => {
  const describe_ = (id: string) => id;
  const label = (match: BookMatchResult) => labelOf(match, describe_);

  it("says what each kind of match is", () => {
    expect(label({ kind: "known", lineId: "b:1", via: "text" })).toBe("Already there · b:1");
    expect(label({ kind: "correction", lineId: "b:1", current: "x", via: "owner" })).toBe("Correction · b:1");
    expect(label({ kind: "translation", lineId: "b:1", via: "moderator" })).toBe("Translation · b:1");
    expect(label({ kind: "new-page", bookId: "7", pageNumber: 3, via: "title" })).toBe("New page · book:7 p.3");
    expect(label({ kind: "new-book", title: "Tome", pageNumber: 2, via: "none" })).toBe("New book · Tome p.2");
    expect(label({ kind: "new-book", title: "", pageNumber: 2, via: "none" })).toBe("New book · untitled p.2");
    expect(label({ kind: "ambiguous", candidates: ["b:1", "b:2"] })).toBe("Ambiguous · 2 candidates");
  });
});

describe("bookFor", () => {
  const match: BookMatchResult = { kind: "translation", lineId: "b:1", via: "owner" };

  it("summarises a readables row, with a link where the match names a page", () => {
    const row = { source: "readables", meta: { book: " Livro ", number: "2" } };
    expect(bookFor(row, match, (id) => id, (id) => `/readables/r/${id}`)).toEqual({
      title: "Livro", number: 2, match, label: "Translation · b:1", href: "/readables/r/b:1", candidates: [],
    });
    expect(bookFor(row, { kind: "new-book", title: "Livro", pageNumber: 2, via: "none" }, (id) => id, (id) => id)?.href).toBeNull();
  });

  it("is null for a row that is not readables", () => {
    expect(bookFor({ source: "places", meta: {} }, match, (id) => id)).toBeNull();
  });
});

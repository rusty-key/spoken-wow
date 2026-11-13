import { describe, expect, it } from "vitest";

import type { Corpus, CorpusLine } from "@/lib/corpus";

import { formatTarget, parseTarget, resolveTarget } from "./target";

function line(overrides: Partial<CorpusLine>): CorpusLine {
  return {
    lineId: "q:1:accept",
    source: "accept",
    questId: 1,
    questTitle: "A Quest",
    npcId: 7,
    npcName: "Someone",
    npcType: "creature",
    race: "Human",
    gender: "male",
    flavor: null,
    voice: "human-male-a",
    playerGender: null,
    text: "hello",
    originalText: "hello",
    fileName: "1-accept",
    generatable: true,
    skipReason: null,
    ...overrides,
  } as CorpusLine;
}

const corpus = {
  schemaVersion: 1,
  generatedAt: "2026-01-01T00:00:00Z",
  lineCount: 3,
  spawns: {},
  lines: [
    line({}),
    line({ lineId: "q:1:complete", source: "complete", fileName: "1-complete" }),
    line({ lineId: "g:abc", source: "gossip", questId: null, npcId: 9, fileName: "abc" }),
    line({ lineId: "g:guard", source: "gossip", questId: null, npcId: 68, fileName: "guard" }),
    line({
      lineId: "g:poster",
      source: "gossip",
      questId: null,
      npcId: 68,
      npcType: "gameobject",
      fileName: "poster",
    }),
    line({
      lineId: "g:chest",
      source: "gossip",
      questId: null,
      npcId: 70,
      npcType: "gameobject",
      fileName: "chest",
    }),
  ],
} as Corpus;

describe("parseTarget", () => {
  it("parses a quest address", () => {
    expect(parseTarget(["quest", "1234", "accept"])).toEqual({
      kind: "quest",
      questId: 1234,
      event: "accept",
    });
  });

  it("parses an npc address", () => {
    expect(parseTarget(["npc", "5678"])).toEqual({ kind: "npc", npcId: 5678 });
  });

  it("parses an object address", () => {
    expect(parseTarget(["object", "68"])).toEqual({ kind: "object", objectId: 68 });
  });

  it("rejects gossip as a quest event, since gossip has no quest", () => {
    expect(parseTarget(["quest", "1234", "gossip"])).toBeNull();
  });

  it("rejects non-numeric and non-positive ids", () => {
    expect(parseTarget(["npc", "abc"])).toBeNull();
    expect(parseTarget(["quest", "0", "accept"])).toBeNull();
  });

  it("rejects a path with the wrong number of segments", () => {
    expect(parseTarget(["quest", "1"])).toBeNull();
    expect(parseTarget(["npc", "1", "accept"])).toBeNull();
    expect(parseTarget([])).toBeNull();
  });
});

describe("formatTarget", () => {
  it("round-trips through parseTarget", () => {
    const target = { kind: "quest", questId: 12, event: "complete" } as const;
    expect(formatTarget(target)).toBe("quest/12/complete");
    expect(parseTarget(formatTarget(target).split("/"))).toEqual(target);
    const object = { kind: "object", objectId: 68 } as const;
    expect(formatTarget(object)).toBe("object/68");
    expect(parseTarget(formatTarget(object).split("/"))).toEqual(object);
  });
});

describe("resolveTarget", () => {
  it("finds the line for a quest address", async () => {
    const found = await resolveTarget({ kind: "quest", questId: 1, event: "complete" }, corpus);
    expect(found.map((found) => found.lineId)).toEqual(["q:1:complete"]);
  });

  it("finds every line for an npc address", async () => {
    const found = await resolveTarget({ kind: "npc", npcId: 9 }, corpus);
    expect(found.map((l) => l.lineId)).toEqual(["g:abc"]);
  });

  it("keeps a creature's address and an object's of the same id apart", async () => {
    const creature = await resolveTarget({ kind: "npc", npcId: 68 }, corpus);
    expect(creature.map((found) => found.lineId)).toEqual(["g:guard"]);
    const object = await resolveTarget({ kind: "object", objectId: 68 }, corpus);
    expect(object.map((found) => found.lineId)).toEqual(["g:poster"]);
  });

  it("reads an npc address naming only an object as that object, as older builds sent it", async () => {
    const found = await resolveTarget({ kind: "npc", npcId: 70 }, corpus);
    expect(found.map((line) => line.lineId)).toEqual(["g:chest"]);
  });

  it("returns an empty array when nothing matches, rather than throwing", async () => {
    expect(await resolveTarget({ kind: "quest", questId: 999, event: "accept" }, corpus)).toEqual(
      [],
    );
  });
});

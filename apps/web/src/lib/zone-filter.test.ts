import { describe, expect, it } from "vitest";

import type { CorpusLine } from "./corpus";
import { matchingLines } from "./search";

// Thork, met at the Crossroads; a trainer met in Orgrimmar and The Barrens.
const SIGHTED = new Map([
  ["creature:3429", [1413]],
  ["creature:3352", [1454, 1413]],
]);

const line = (questId: number | null, npcId: number, npcType: CorpusLine["npcType"] = "creature"): CorpusLine => ({
  lineId: questId === null ? `g:${npcType}:${npcId}` : `q:${questId}:accept`,
  source: questId === null ? "gossip" : "accept",
  questId,
  questTitle: questId === null ? null : "A quest",
  npcId,
  npcName: "Someone",
  npcType,
  race: "human",
  gender: "male",
  flavor: null,
  voice: "human-male",
  playerGender: null,
  text: "Hello.",
  originalText: "Hello.",
  fileName: `${npcId}.ogg`,
  generatable: true,
  skipReason: null,
});

// A line is in each zone players met its speaker in: a quest's accept line where its giver stands.
describe("the zone filter", () => {
  const corpus = {
    lines: [line(7, 3429), line(null, 3429), line(null, 3352), line(null, 1), line(null, 3429, "gameobject")],
  };
  const ids = (zone?: number, sightings = SIGHTED) =>
    matchingLines(corpus, new Set(), { zone }, { overrides: new Map(), sightings }).map((l) => l.lineId);

  it("keeps the lines in the zone, a speaker met in several zones under each", () => {
    expect(ids(1413).sort()).toEqual(["g:creature:3352", "g:creature:3429", "q:7:accept"]);
    expect(ids(1454)).toEqual(["g:creature:3352"]);
  });

  it("leaves out a speaker nobody vouched for, and an object sharing a vouched creature's id", () => {
    expect(ids(1413)).not.toContain("g:gameobject:3429");
    expect(ids(1413)).not.toContain("g:creature:1");
  });

  it("matches nothing without the sightings, rather than everything", () => {
    expect(ids(1413, new Map())).toEqual([]);
  });

  it("is off without a zone", () => {
    expect(ids()).toHaveLength(5);
  });
});

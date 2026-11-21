import { describe, expect, it } from "vitest";

import type { CorpusLine } from "../corpus";
import { matchingLines } from "../search";
import { zonesOf } from "./zones";

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

describe("zonesOf", () => {
  it("puts a line, quest or gossip, in each zone players met its speaker in", () => {
    expect(zonesOf(line(7, 3429), SIGHTED)).toEqual([1413]);
    expect(zonesOf(line(null, 3352), SIGHTED)).toEqual([1454, 1413]);
  });

  it("places a speaker nobody has vouched for nowhere, and keeps creatures and objects apart", () => {
    expect(zonesOf(line(null, 1), SIGHTED)).toEqual([]);
    expect(zonesOf(line(null, 3429, "gameobject"), SIGHTED)).toEqual([]);
    expect(zonesOf(line(null, 3429))).toEqual([]);
  });
});

describe("the zone filter", () => {
  const corpus = { lines: [line(7, 3429), line(null, 3429), line(null, 3352), line(null, 1)] };
  const ids = (zone?: number, sightings = SIGHTED) =>
    matchingLines(corpus, new Set(), { zone }, { overrides: new Map(), sightings }).map((l) => l.lineId);

  it("keeps the lines in the zone, a speaker met in several zones under each", () => {
    expect(ids(1413).sort()).toEqual(["g:creature:3352", "g:creature:3429", "q:7:accept"]);
    expect(ids(1454)).toEqual(["g:creature:3352"]);
  });

  it("matches nothing without the sightings, rather than everything", () => {
    expect(ids(1413, new Map())).toEqual([]);
  });

  it("is off without a zone", () => {
    expect(ids()).toHaveLength(4);
  });
});

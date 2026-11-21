import { describe, expect, it, vi } from "vitest";

import type { CorpusLine } from "../corpus";
import { matchingLines } from "../search";
import { zonesOf, type ZonesFile } from "./zones";

// Kobold Camp Cleanup in Elwynn; Thork at the Crossroads; a trainer in Orgrimmar and The Barrens.
const FILE: ZonesFile = vi.hoisted(() => ({
  zones: [
    { uiMapID: 1429, name: "Elwynn Forest" },
    { uiMapID: 1454, name: "Orgrimmar" },
    { uiMapID: 1413, name: "The Barrens" },
  ],
  quests: { "7": [1429] },
  speakers: { "creature:3429": [1413], "creature:3352": [1454, 1413] },
}));

vi.mock("@quests-corpus/zones.json", () => ({ default: FILE }));

const line = (questId: number | null, npcId: number): CorpusLine => ({
  lineId: questId === null ? `g:${npcId}` : `q:${questId}:accept`,
  source: questId === null ? "gossip" : "accept",
  questId,
  questTitle: questId === null ? null : "A quest",
  npcId,
  npcName: "Someone",
  npcType: "creature",
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
  it("puts a quest's lines where the Compendium files the quest, wherever the speaker stands", () => {
    expect(zonesOf(line(7, 3429), FILE)).toEqual([1429]);
  });

  it("puts gossip, and a quest the Compendium files under no zone, where the speaker stands", () => {
    expect(zonesOf(line(null, 3352), FILE)).toEqual([1454, 1413]);
    expect(zonesOf(line(1500, 3352), FILE)).toEqual([1454, 1413]);
  });

  it("keeps creatures and objects with the same id apart, and places neither it does not know", () => {
    expect(zonesOf({ ...line(null, 3429), npcType: "gameobject" }, FILE)).toEqual([]);
  });
});

describe("the zone filter", () => {
  const corpus = { lines: [line(7, 3429), line(null, 3429), line(null, 3352), line(null, 1)] };
  const ids = (zone?: number) => matchingLines(corpus, new Set(), { zone }).map((l) => l.lineId);

  it("keeps the lines in the zone, a speaker in several zones under each", () => {
    expect(ids(1413)).toEqual(["g:3352", "g:3429"]);
    expect(ids(1429)).toEqual(["q:7:accept"]);
  });

  it("is off without a zone", () => {
    expect(ids()).toHaveLength(4);
  });
});

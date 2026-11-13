import { describe, expect, it } from "vitest";

import type { Corpus, CorpusLine } from "@/lib/corpus";
import { BASE_LANG } from "@/lib/lang";

import { npcDetails } from "./npc";

function line(overrides: Partial<CorpusLine>): CorpusLine {
  return {
    lineId: "g:abc",
    source: "gossip",
    questId: null,
    questTitle: null,
    npcId: 9,
    npcName: "Innkeeper Farley",
    npcType: "creature",
    race: "Human",
    gender: "male",
    flavor: null,
    voice: "human-male-a",
    playerGender: null,
    text: "hello",
    originalText: "hello",
    fileName: "abc",
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
    line({ lineId: "g:def", fileName: "def" }),
    line({ lineId: "q:1:accept", source: "accept", questId: 1, questTitle: "A Quest", npcId: 7, npcName: "Someone" }),
  ],
} as unknown as Corpus;

describe("npcDetails", () => {
  it("names the speaker, what picked the voice and how many lines they say", async () => {
    const details = await npcDetails(["npc/9"], BASE_LANG, corpus);
    expect(details["npc/9"]).toMatchObject({
      heading: "Innkeeper Farley",
      speakerIsHeading: true,
      speaker: { name: "Innkeeper Farley" },
      aside: "Human male · human-male-a · 2 lines",
    });
  });

  it("leaves out quest addresses and NPCs the corpus does not have", async () => {
    expect(await npcDetails(["quest/1/accept", "npc/404", "nonsense"], BASE_LANG, corpus)).toEqual({});
  });
});

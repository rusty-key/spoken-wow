import { describe, expect, it } from "vitest";

import type { CorpusLine } from "@/lib/corpus";

import { defaultSampleLines, previewTextCandidates, slotNpcs } from "./lines";

const SLOT = "orc-male-shady";

function line(lineId: string, text: string, extra: Partial<CorpusLine> = {}): CorpusLine {
  return {
    lineId,
    source: "quests",
    questId: null,
    questTitle: null,
    npcId: 1,
    npcName: "Ulathek",
    npcType: "creature",
    race: "orc",
    gender: "male",
    flavor: "shady",
    voice: SLOT,
    playerGender: null,
    text,
    originalText: text,
    fileName: lineId,
    generatable: true,
    skipReason: null,
    ...extra,
  } as CorpusLine;
}

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

describe("defaultSampleLines", () => {
  const lines = [
    line("q:1:accept", words(30)),
    line("q:2:accept", words(60)),
    line("f:1:orc-male-shady", "You dog! Now I'll trap your soul!"),
    line("f:2:orc-male-shady", "Die!"),
    line("g:a", words(10)),
    line("g:b", words(20)),
    line("g:c", words(25)),
    line("q:3:accept", `${words(80)} <He laughs.> ${words(3)}`),
    line("q:4:accept", words(90), { voice: "orc-male-guard" }),
  ];

  it("takes the longest quest text, the shortest bark worth hearing, and a middling gossip line", () => {
    expect(defaultSampleLines(lines, SLOT).map((l) => l.lineId)).toEqual(["q:2:accept", "f:1:orc-male-shady", "g:b"]);
  });

  it("never picks a line with narration, or another slot's", () => {
    const ids = defaultSampleLines(lines, SLOT).map((l) => l.lineId);
    expect(ids).not.toContain("q:3:accept");
    expect(ids).not.toContain("q:4:accept");
  });

  it("fills from what the slot has when a kind is missing", () => {
    const quests = [line("q:1:accept", words(10)), line("q:2:accept", words(20)), line("q:5:accept", words(30))];
    expect(defaultSampleLines(quests, SLOT)).toHaveLength(3);
  });
});

describe("slotNpcs", () => {
  it("names the slot's NPCs busiest first", () => {
    const lines = [line("q:1", "a", { npcName: "Snarl" }), line("q:2", "b"), line("q:3", "c")];
    expect(slotNpcs(lines, SLOT)).toEqual(["Ulathek", "Snarl"]);
  });
});

describe("previewTextCandidates", () => {
  it("offers lines of 100 to 300 characters", () => {
    const texts = previewTextCandidates([line("q:1", words(5)), line("q:2", words(30)), line("q:3", words(80))], SLOT);
    expect(texts).toEqual([words(30)]);
  });
});

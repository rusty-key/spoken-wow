import { describe, expect, it } from "vitest";

import type { CorpusLine } from "@/lib/corpus";
import { search } from "@/lib/search";
import { familyOfBuild, markExpansions, type ExpansionFacts } from "./expansion";

function line(lineId: string, questId: number | null, contributionId: number | null = null): CorpusLine {
  return {
    lineId,
    source: questId === null ? "gossip" : "accept",
    questId,
    questTitle: null,
    npcId: 1,
    npcName: "",
    npcType: "creature",
    race: "human",
    gender: "male",
    flavor: "standard",
    voice: "human-male-standard",
    playerGender: null,
    text: "Greetings.",
    originalText: "Greetings.",
    fileName: lineId,
    generatable: true,
    skipReason: null,
    contributionId,
  };
}

const facts: ExpansionFacts = {
  extractedQuests: new Set([1324, 9665]),
  contributionClients: new Map([
    [1, familyOfBuild("2.5.5/63796")],
    [2, familyOfBuild("1.60.1/70235")],
    [3, familyOfBuild("1.15.7/62581")],
  ]),
};

const tbcOf = (lines: CorpusLine[]) =>
  Object.fromEntries(markExpansions(lines, facts).map((row) => [`${row.lineId}#${row.contributionId}`, row.expansion ?? null]));

describe("markExpansions", () => {
  it("takes a quest the Classic extract lacks, below the ceiling, as TBC", () => {
    // q:8326 is Sunstrider Isle, q:9463 the Exodar, both sent by players and Wowhead.
    expect(tbcOf([line("q:8326:accept", 8326, 2), line("q:9463:accept", 9463)])).toEqual({
      "q:8326:accept#2": "tbc",
      "q:9463:accept#null": "tbc",
    });
  });

  it("leaves the extract's quests, Season of Discovery's and Forever's as Classic", () => {
    // Even sent from TBC Anniversary: a Classic quest is Classic in either client.
    expect(
      tbcOf([
        line("q:1324:accept", 1324),
        line("q:9665:complete", 9665, 1),
        line("q:78132:accept", 78132, 3),
        line("q:94237:accept", 94237, 2),
      ]),
    ).toEqual({
      "q:1324:accept#null": null,
      "q:9665:complete#1": null,
      "q:78132:accept#3": null,
      "q:94237:accept#2": null,
    });
  });

  it("takes gossip as TBC only when every speaker of the line came from TBC Anniversary", () => {
    expect(
      tbcOf([
        line("g:aaa", null, 1),
        line("g:bbb", null, 1),
        line("g:bbb", null, 2),
        line("g:ccc", null, 1),
        line("g:ccc", null),
      ]),
    ).toEqual({
      "g:aaa#1": "tbc",
      "g:bbb#1": null,
      "g:bbb#2": null,
      "g:ccc#1": null,
      "g:ccc#null": null,
    });
  });
});

describe("the TBC filter", () => {
  const corpus = { lines: markExpansions([line("q:1324:accept", 1324), line("q:9463:accept", 9463)], facts) };
  const ids = (filters: Parameters<typeof search>[2]) =>
    search(corpus, new Set(), filters).lines.map((row) => row.lineId);

  it("hides TBC lines unless asked for", () => {
    expect(ids({})).toEqual(["q:1324:accept"]);
    expect(ids({ includeTbc: true })).toEqual(["q:1324:accept", "q:9463:accept"]);
  });

  it("finds a TBC line by its id, so a report or contribution link still reaches it", () => {
    expect(ids({ line: "q:9463:accept" })).toEqual(["q:9463:accept"]);
  });
});

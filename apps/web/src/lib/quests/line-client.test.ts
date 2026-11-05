import { describe, expect, it } from "vitest";

import type { CorpusLine } from "@/lib/corpus";
import { search } from "@/lib/search";
import { markClients, type LineClientFacts } from "./line-client";

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

const facts: LineClientFacts = {
  extractedQuests: new Set([1324, 9665]),
  contributionBuilds: new Map([
    [1, "2.5.5/63796"],
    [2, "1.60.1/70235"],
    [3, "1.15.7/62581"],
    [4, "3.3.5/12340"],
  ]),
};

const clientsOf = (lines: CorpusLine[]) =>
  Object.fromEntries(markClients(lines, facts).map((row) => [`${row.lineId}#${row.contributionId}`, row.clientFamily ?? null]));

describe("markClients", () => {
  it("takes a speaker's client from the contribution that wrote it, and none from the extract", () => {
    expect(
      clientsOf([
        line("q:1324:accept", 1324),
        line("q:9665:complete", 9665, 1),
        line("q:78132:accept", 78132, 3),
        line("q:94237:accept", 94237, 2),
        line("g:aaa", null, 4),
      ]),
    ).toEqual({
      "q:1324:accept#null": null,
      // A Classic quest sent from TBC Anniversary is that client's row, but the extract's own
      // speakers of it stay with the focus bin.
      "q:9665:complete#1": "anniversary",
      "q:78132:accept#3": "era",
      "q:94237:accept#2": "forever",
      "g:aaa#4": "legacy",
    });
  });

  it("takes a quest the Classic extract lacks, below the ceiling, as TBC whatever sent it", () => {
    // q:8326 is Sunstrider Isle; Wowhead's TBC pages came in with a Forever build.
    expect(clientsOf([line("q:8326:accept", 8326, 2), line("q:9463:accept", 9463)])).toEqual({
      "q:8326:accept#2": "anniversary",
      "q:9463:accept#null": "anniversary",
    });
  });
});

describe("the client filter", () => {
  const corpus = {
    lines: markClients(
      [
        line("q:1324:accept", 1324),
        line("q:9463:accept", 9463),
        line("q:94237:accept", 94237, 2),
        line("g:aaa", null, 4),
      ],
      facts,
    ),
  };
  const ids = (filters: Parameters<typeof search>[2]) =>
    search(corpus, new Set(), filters).lines.map((row) => row.lineId).sort();

  it("shows Era + Forever by default, the way the Contributions pages do", () => {
    expect(ids({})).toEqual(["q:1324:accept", "q:94237:accept"]);
    expect(ids({ client: "low-effort" })).toEqual(["g:aaa", "q:9463:accept"]);
    expect(ids({ client: "anniversary" })).toEqual(["q:9463:accept"]);
    expect(ids({ client: "all" })).toHaveLength(4);
  });

  it("finds any line by its id, so a report or contribution link still reaches it", () => {
    expect(ids({ line: "q:9463:accept" })).toEqual(["q:9463:accept"]);
  });
});

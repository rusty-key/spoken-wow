import { describe, expect, it } from "vitest";

import { corpus } from "@/lib/quests/catalogue";

import {
  answersQuestMoment,
  baseLineId,
  broadcastGossipStem,
  gossipFileName,
  gossipHash,
  gossipLineId,
  gossipStemRank,
  localizedGossipStem,
  questFileName,
  questLineId,
  variantFileName,
  variantLineId,
} from "./naming";

describe("questLineId / questFileName", () => {
  it("matches a real corpus id and file -- q:33:accept -> 33-accept", async () => {
    const line = (await corpus()).lines.find((l) => l.lineId === "q:33:accept");
    expect(line).toBeDefined();
    expect(questLineId(33, "accept")).toBe(line!.lineId);
    expect(questFileName(33, "accept")).toBe(line!.fileName);
  });

  it("carries the event through unchanged", () => {
    expect(questLineId(76156, "progress")).toBe("q:76156:progress");
    expect(questFileName(76156, "progress")).toBe("76156-progress");
  });
});

describe("gossipHash / gossipLineId / gossipFileName", () => {
  it("matches a real corpus gossip line: md5(originalText + race + gender)", async () => {
    const line = (await corpus()).lines.find((l) => l.source === "gossip" && l.playerGender === null);
    expect(line).toBeDefined();
    const hash = gossipHash(line!.originalText, line!.race, line!.gender);
    expect(gossipLineId(hash)).toBe(line!.lineId);
    expect(gossipFileName(hash)).toBe(line!.fileName);
  });

  it("changes with the race or the gender, not just the text", () => {
    const a = gossipHash("Halt!", "human", "male");
    const b = gossipHash("Halt!", "human", "female");
    const c = gossipHash("Halt!", "orc", "male");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("answersQuestMoment", () => {
  it("matches the bare id and its player-gender variants, and nothing else", () => {
    expect(answersQuestMoment("q:166:complete", "q:166:complete")).toBe(true);
    expect(answersQuestMoment("q:166:complete:m", "q:166:complete")).toBe(true);
    expect(answersQuestMoment("q:166:complete:f", "q:166:complete")).toBe(true);
    expect(answersQuestMoment("q:1666:complete", "q:166:complete")).toBe(false);
    expect(answersQuestMoment("q:166:accept", "q:166:complete")).toBe(false);
  });
});

describe("upgradeable gossip stems", () => {
  // Pinned to tests/test_naming.py's test_broadcast_and_localized_gossip_stems.
  it("names a broadcast line after its id and voice, and a localized one after its language", () => {
    expect(broadcastGossipStem(6029, "orc-female-standard")).toBe("b6029-orc-female-standard");
    expect(localizedGossipStem("deDE", "0".repeat(32))).toBe(`deDE-${"0".repeat(32)}`);
  });

  it("ranks broadcast, then English, then localized", () => {
    expect(gossipStemRank("b6029-orc-female-standard")).toBe(0);
    expect(gossipStemRank(`bad0c0ffee${"0".repeat(22)}`)).toBe(1);
    expect(gossipStemRank(`deDE-${"0".repeat(32)}`)).toBe(2);
  });
});

describe("variantLineId / variantFileName", () => {
  // The same vectors as pipelines/quests/tests/test_naming.py's VOICED.
  it.each([
    ["q:109:accept", "109-accept", "human-male-standard", "q:109:accept~human-male-standard", "109-accept-human-male-standard"],
    ["q:109:complete:f", "f-109-complete", "dwarf-female-standard", "q:109:complete:f~dwarf-female-standard", "f-109-complete-dwarf-female-standard"],
    ["g:abc123:m", "m-abc123", "human-male-warrior", "g:abc123:m~human-male-warrior", "m-abc123-human-male-warrior"],
    ["f:4377:dwarf-male-standard", "4377-dwarf-male-standard", "dwarf-male-grim", "f:4377:dwarf-male-standard~dwarf-male-grim", "4377-dwarf-male-standard-dwarf-male-grim"],
  ])("names %s in another voice after it", (lineId, fileName, voice, variantId, variantFile) => {
    expect(variantLineId(lineId, voice)).toBe(variantId);
    expect(variantFileName(fileName, voice)).toBe(variantFile);
  });
});

describe("baseLineId", () => {
  it("is the line a voice's line is of, and a plain line itself", () => {
    expect(baseLineId(variantLineId("q:109:accept:m", "tauren-male-elder"))).toBe("q:109:accept:m");
    expect(baseLineId("g:abc")).toBe("g:abc");
  });
});

import { describe, expect, it } from "vitest";

import { targetForLine } from "./line-target";
import { parseTarget } from "./target";

const quest = {
  lineId: "q:5:accept",
  source: "accept",
  questId: 5,
  npcId: 288,
  npcType: "creature",
} as Parameters<typeof targetForLine>[0];

const gossip = {
  lineId: "g:abc123",
  source: "gossip",
  questId: null,
  npcId: 68,
  npcType: "creature",
} as Parameters<typeof targetForLine>[0];

const poster = { ...gossip, npcType: "gameobject" } as typeof gossip;

const followup = {
  lineId: "f:1242:human-male-official",
  source: "followup",
  questId: 54,
  npcId: 197,
  npcType: "creature",
} as Parameters<typeof targetForLine>[0];

const chatter = { ...followup, source: "chatter", questId: null } as typeof followup;

const progress = { ...quest, lineId: "q:7:progress", source: "progress", questId: 7 } as typeof quest;

describe("targetForLine", () => {
  it("addresses a quest line by quest and event", () => {
    expect(targetForLine(quest)).toBe("quest/5/accept");
    expect(targetForLine(progress)).toBe("quest/7/progress");
  });

  it("addresses a gossip line by its speaker, which has no quest to name", () => {
    expect(targetForLine(gossip)).toBe("npc/68");
  });

  it("addresses an object's line as an object, whose ids overlap creatures'", () => {
    expect(targetForLine(poster)).toBe("object/68");
  });

  it("addresses a follow-up line by its speaker, not by the quest it follows", () => {
    // quest/54/complete would resolve to Marshal McBride's turn-in text, which is not the
    // line being reported; his NPC address resolves to every line he has, this one included.
    expect(targetForLine(followup)).toBe("npc/197");
  });

  it("addresses an NPC's chat in the world by its speaker, as it has no quest", () => {
    expect(targetForLine(chatter)).toBe("npc/197");
  });

  it("produces addresses the report page can parse", () => {
    // The whole point of reusing the addon's address format: a report filed from the site and
    // one filed from the game land on the same target string, so triage sees one kind of row.
    for (const line of [quest, progress, gossip, poster, followup, chatter]) {
      const address = targetForLine(line);
      expect(address).not.toBeNull();
      expect(parseTarget(address!.split("/"))).not.toBeNull();
    }
  });

  it("refuses a quest line with no quest id", () => {
    // Nothing in the corpus should look like this, and an address of "quest/null/accept"
    // would resolve to nothing while looking like a real report.
    expect(targetForLine({ ...quest, questId: null })).toBeNull();
  });
});

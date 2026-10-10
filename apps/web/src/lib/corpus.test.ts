import { describe, expect, it } from "vitest";

import { buildLineIndex, npcKey } from "./corpus";
import { corpus as catalogue, defaultFlavorFor, flavorsFor, lineIndex } from "./quests/catalogue";

describe("corpus", async () => {
  const corpus = await catalogue();

  it("loads the committed corpus", async () => {
    expect(corpus.lines.length).toBeGreaterThan(17000);
  });

  it("carries the fields the explorer searches on", async () => {
    const line = corpus.lines.find((l) => l.lineId === "q:5:accept");
    expect(line).toBeDefined();
    expect(line!.npcName).toBe("Jitters");
    expect(line!.questTitle).toBe("Jitters' Growling Gut");
    expect(line!.fileName).toBe("5-accept");
    expect(line!.voice).toBe("human-male-standard");
  });

  it("namespaces npc keys by type", async () => {
    // creature 68 is a Stormwind City Guard, gameobject 68 is a Wanted Poster
    expect(npcKey({ npcType: "creature", npcId: 68 })).not.toBe(
      npcKey({ npcType: "gameobject", npcId: 68 }),
    );
  });

  it("memoises, so repeated loads do not re-parse", async () => {
    expect((await catalogue()).lines).toBe(corpus.lines);
  });
});

// One lineId can belong to many lines. A gossip lineId is g:{md5(text + race + gender)}, so
// every dwarf man with the same greeting shares one id and one mp3 - which is what makes
// regeneration an operation on a file rather than on an NPC's line.
describe("lineIndex", async () => {
  const index = await lineIndex();

  it("indexes every line in the corpus", async () => {
    const total = [...index.values()].reduce((sum, group) => sum + group.length, 0);
    expect(total).toBe((await catalogue()).lines.length);
  });

  it("finds a quest line under its id", async () => {
    expect(index.get("q:5:accept")!.map((l) => l.npcName)).toContain("Jitters");
  });

  it("groups the NPCs that share a gossip line", async () => {
    const shared = [...index.values()].filter(
      (group) => group.length > 1 && group[0].source === "gossip",
    );
    expect(shared.length).toBeGreaterThan(0);

    // Text, voice and filename are properties of the line; only the speaker varies.
    for (const group of shared.slice(0, 50)) {
      expect(new Set(group.map((l) => l.text)).size).toBe(1);
      expect(new Set(group.map((l) => l.voice)).size).toBe(1);
      expect(new Set(group.map((l) => l.fileName)).size).toBe(1);
    }
  });

  it("memoises", async () => {
    expect(await lineIndex()).toBe(index);
    expect(buildLineIndex(await catalogue())).not.toBe(index);
  });
});

describe("defaultFlavorFor", () => {
  // Mirrors tts_cli/flavors.py's fallback_flavors -- pinned against the real, committed
  // corpus rather than a fixture, so a change to either side that breaks the mirror shows up
  // here. tauren-male is the branch's own flagship case (model 122055): it has no "standard"
  // voice in the game at all, only elder/shaman/warrior, so the busiest -- warrior -- is the
  // honest default, not a hardcoded name that would point at nothing.
  it("is the busiest flavor for a race-gender with no standard voice", async () => {
    expect(await defaultFlavorFor("tauren", "male")).toBe("warrior");
  });

  it("is the busiest flavor for another race-gender with no standard voice", async () => {
    expect(await defaultFlavorFor("goblin", "female")).toBe("zany");
  });

  // human-male's busiest flavor is "official" (1164 lines vs. standard's 845), and "standard"
  // still wins: fallback_flavors picks it whenever it exists at all, busiest or not.
  it("is 'standard' for a race-gender that has one, even when it is not the busiest", async () => {
    expect(await defaultFlavorFor("human", "male")).toBe("standard");
  });

  it("is null for a race-gender the corpus has never carried a flavored line for at all", async () => {
    expect(await defaultFlavorFor("murloc", "male")).toBe(null);
  });

  it("falls back to the roster's first flavor for a race-gender with no lines", async () => {
    expect(await defaultFlavorFor("skybourneelf", "female")).toBe("3773");
  });
});

describe("flavorsFor", async () => {
  // The triage table's own flagship case: a moderator staring at a tauren male must be offered
  // exactly the voice sets that exist for one, never a name that would produce a filename
  // nothing can generate.
  it("lists every flavor a race-gender carries, not just the default", async () => {
    expect(await flavorsFor("tauren", "male")).toEqual(["elder", "shaman", "warrior"]);
  });

  it("lists a single flavor for a race-gender that has only one", async () => {
    expect(await flavorsFor("goblin", "female")).toEqual(["zany"]);
  });

  it("is empty for a race-gender the corpus has never carried a flavored line for at all", async () => {
    expect(await flavorsFor("murloc", "male")).toEqual([]);
  });

  it("offers the declared voice sets of a race-gender with no lines yet", async () => {
    expect(await flavorsFor("skybourneelf", "male")).toEqual(["3775", "3776"]);
  });

  it("agrees with defaultFlavorFor: the default is always one of the offered options", async () => {
    for (const [race, gender] of [["human", "male"], ["tauren", "male"], ["goblin", "female"]] as const) {
      expect(await flavorsFor(race, gender)).toContain(await defaultFlavorFor(race, gender));
    }
  });
});

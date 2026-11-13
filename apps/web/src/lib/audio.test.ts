import { describe, expect, it } from "vitest";

import { corpus as catalogue } from "./quests/catalogue";
import { audioRelPath, subfolder, fileIndex } from "./audio";

describe("audio paths", () => {
  it("puts quest lines under quests/", () => {
    expect(audioRelPath({ lineId: "q:5:accept", fileName: "5-accept" })).toBe(
      "quests/5-accept.mp3",
    );
    expect(audioRelPath({ lineId: "q:123:complete", fileName: "123-complete" })).toBe(
      "quests/123-complete.mp3",
    );
  });

  it("puts gossip under gossip/", () => {
    expect(audioRelPath({ lineId: "g:abc123", fileName: "abc123" })).toBe(
      "gossip/abc123.mp3",
    );
  });

  it("puts follow-up lines under followup/, whatever quest they belong to", () => {
    expect(audioRelPath({ lineId: "f:4377:dwarf-male-standard", fileName: "4377-dwarf-male-standard" })).toBe(
      "followup/4377-dwarf-male-standard.mp3",
    );
    expect(subfolder({ lineId: "f:4377:dwarf-male-standard" })).toBe("followup");
  });

  it("goes by the line id's kind, so NPC chat named as a follow-up line shares followup/", () => {
    expect(audioRelPath({ lineId: "f:1309:human-female-standard", fileName: "1309-human-female-standard" })).toBe(
      "followup/1309-human-female-standard.mp3",
    );
  });

  it("refuses a line id of no known kind rather than guessing quests/", () => {
    expect(() => subfolder({ lineId: "x:1" })).toThrow();
  });

  it("keeps the gender prefix Python put in the filename", () => {
    // The prefix is part of fileName, never added here.
    expect(subfolder({ lineId: "g:abc123:m" })).toBe("gossip");
    expect(audioRelPath({ lineId: "g:abc123:m", fileName: "m-abc123" })).toBe(
      "gossip/m-abc123.mp3",
    );
  });
});

describe("fileIndex as the whitelist of addressable paths", async () => {
  const files = await fileIndex();

  it("contains every path the explorer would link to", async () => {
    for (const line of (await catalogue()).lines.slice(0, 500)) {
      expect(files.has(audioRelPath(line))).toBe(true);
    }
  });

  it("holds one entry per distinct file, not per line", async () => {
    // 14,315 generatable lines collapse to 11,081 files: a gossip file is named
    // md5(text + race + gender), so NPCs sharing a line share an mp3.
    expect(files.size).toBeLessThan((await catalogue()).lines.length);
    expect(files.size).toBeGreaterThan(10000);
  });

  it("rejects traversal and anything outside the two subfolders", () => {
    for (const bad of [
      "../etc/passwd",
      "quests/../../etc/passwd.mp3",
      "/etc/passwd",
      "sounds/5-accept.mp3",
      "quests/5-accept.wav",
      "quests/does-not-exist.mp3",
      "",
    ]) {
      expect(files.has(bad)).toBe(false);
    }
  });

  it("memoises", async () => {
    expect(await fileIndex()).toBe(files);
  });
});

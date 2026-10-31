import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-history-"));
const HISTORY = path.join(root, "audio-history");

// paths.ts reads the environment at import time, so this has to be set before the module
// graph is pulled in - hence the dynamic import below rather than a top-level one.
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = HISTORY;

const { historyDirOf } = await import("./adapters");
const historyDir = (file: string) => historyDirOf("quests", file);

const FILE = "gossip/31ab172e1a375db1c9157d594eb608d9.mp3";

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("paths", () => {
  it("puts a file's takes in their own directory, one level deeper than its addon path", () => {
    expect(historyDir(FILE)).toBe(
      path.join(HISTORY, "gossip", "31ab172e1a375db1c9157d594eb608d9"),
    );
    expect(historyDir("quests/5-accept.mp3")).toBe(path.join(HISTORY, "quests", "5-accept"));
  });

  it("refuses anything that is not an addon-relative mp3", () => {
    for (const bad of [
      "../etc/passwd",
      "gossip/../../etc/passwd.mp3",
      "/absolute/x.mp3",
      "sounds/x.mp3",
      "gossip/x.wav",
      "gossip/sub/x.mp3",
    ]) {
      expect(() => historyDir(bad)).toThrow(/unsafe store path/);
    }
  });
});

describe("bosses", () => {
  const BOSSES = path.join(root, "bosses-history");

  it("archives under SPOKEN_BOSSES_AUDIO_HISTORY, another language one level down", () => {
    process.env.SPOKEN_BOSSES_AUDIO_HISTORY = BOSSES;
    try {
      expect(historyDirOf("bosses", "36/edwin-vancleef")).toBe(path.join(BOSSES, "36", "edwin-vancleef"));
      expect(historyDirOf("bosses", "36/edwin-vancleef", "deDE")).toBe(
        path.join(BOSSES, "deDE", "36", "edwin-vancleef"),
      );
    } finally {
      delete process.env.SPOKEN_BOSSES_AUDIO_HISTORY;
    }
  });

  it("falls back to the places pipeline's bosses-audio-history, apart from places' own takes", () => {
    expect(historyDirOf("bosses", "36/edwin-vancleef")).toBe(
      path.resolve(process.cwd(), "..", "..", "pipelines", "places", "bosses-audio-history", "36", "edwin-vancleef"),
    );
  });
});

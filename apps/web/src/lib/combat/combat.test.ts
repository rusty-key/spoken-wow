import { describe, expect, it, vi, beforeEach } from "vitest";
import { crc32 } from "node:zlib";
import { readFileSync } from "node:fs";
import { combatAudioManifest, combatAudioToc } from "./audio-pack";
import { COMBAT_LINES, COMBAT_VOICES } from "./catalogue";
import { recordingsZip } from "./zip";

const mocks = vi.hoisted(() => ({
  commit: vi.fn(), measure: vi.fn(), query: vi.fn(), takePath: vi.fn(), readFile: vi.fn(),
}));
vi.mock("@/lib/takes/commit", () => ({ commitTake: mocks.commit }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/takes/store", () => ({ takePath: mocks.takePath }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/lib/zones/tools", () => ({ durationOf: mocks.measure }));
vi.mock("@/lib/generation/files", () => ({ sentText: (text: string) => text }));
vi.mock("@/lib/generation/lock", () => ({
  BUSY: Symbol("busy"), withTakeLock: (_: string, __: string, work: () => unknown) => work(),
}));

import { regenerateCombatLine } from "./regenerate";
import { combatPackage } from "./package";
import * as recordings from "./recordings";
import { spokenHash } from "@/lib/generation/spoken-hash";
import type { Speaker } from "@/lib/generation/speakers/speaker";

const COMBAT_VOICE = "nightelf-female-player";
const speak = vi.fn();
const speaker: Speaker = {
  provider: "fish", modelId: "test-model", seedStrategy: "npc",
  voices: async () => ({ ids: new Map([[COMBAT_VOICE, "voice-id"]]), error: null }),
  missing: (voice) => `Missing ${voice}`, speak,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commit.mockResolvedValue({ version: 1, bytes: 3 });
  speak.mockResolvedValue({ ok: true, audio: Buffer.from("mp3"), credits: null, costUsd: 0.01,
    leadIn: false, leadInSec: null,
    made: { modelId: "test-model", settings: {}, outputFormat: "mp3", dictionaryId: null, dictionaryVersion: null } });
});

describe("combat recording production", () => {
  it("records the agreed voice through the existing archive with cost and duration metadata", async () => {
    const result = await regenerateCombatLine(COMBAT_LINES[0].id, "actor", speaker);
    expect(result.ok).toBe(true);
    expect(speak).toHaveBeenCalledWith({ turns: [{ text: COMBAT_LINES[0].text, voiceId: "voice-id" }],
      lang: "enUS", seed: null, dialogue: false });
    expect(mocks.commit).toHaveBeenCalledWith("quests", COMBAT_LINES[0].file, Buffer.from("mp3"),
      expect.objectContaining({ voice: COMBAT_VOICE, createdBy: "actor", provider: "fish", costUsd: 0.01,
        spokenHash: spokenHash(COMBAT_LINES[0].text) }), { lang: "enUS", measure: mocks.measure });
  });

  it("rejects unknown ids before asking the provider", async () => {
    expect((await regenerateCombatLine("q:1:accept", "actor", speaker)).ok).toBe(false);
    expect(speak).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("does not substitute another voice when the requested voice is missing", async () => {
    const result = await regenerateCombatLine(COMBAT_LINES[0].id, "actor", {
      ...speaker, voices: async () => ({ ids: new Map(), error: null }),
    });
    expect(result.ok).toBe(false);
    expect(speak).not.toHaveBeenCalled();
  });

  it("does not archive a failed provider response", async () => {
    speak.mockResolvedValue({ ok: false, failure: { message: "quota", status: 402 } });
    expect((await regenerateCombatLine(COMBAT_LINES[0].id, "actor", speaker)).ok).toBe(false);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});

describe("combat download", () => {
  it("registers multiple voice sets independently in one sound pack", () => {
    const manifest = combatAudioManifest(["nightelf-female-player", "dwarf-female-player"].map((voice) => ({
      voice, clips: [{ key: "01", duration: 2 }],
    })));
    expect(manifest).toContain('SpokenCombatAudioPacks[addon .. ":nightelf-female-player"]');
    expect(manifest).toContain('SpokenCombatAudioPacks[addon .. ":dwarf-female-player"]');
  });

  it("does not substitute night elf dialogue for the other fifteen voice sets", () => {
    expect(COMBAT_VOICES).toHaveLength(16);
    expect(COMBAT_VOICES.filter((voice) => voice.lines.length).map((voice) => voice.id)).toEqual([COMBAT_VOICE]);
    expect(COMBAT_LINES.every((line) => line.voice === COMBAT_VOICE)).toBe(true);
  });

  it("exports the same independently versioned addon metadata as the source pack", () => {
    const source = readFileSync(new URL("../../../../../addons/SpokenCombatAudio/SpokenCombatAudio.toc", import.meta.url), "utf8");
    expect(combatAudioToc().trimEnd()).toBe(source.replace(/\r\n/g, "\n").trimEnd());
  });
  function recorded() {
    return COMBAT_LINES.map((line) => ({ file: line.file, version: 2, durationSec: 2.123,
      spokenHash: spokenHash(line.text) }));
  }

  it("refuses incomplete, stale or overlong sets before reading archive files", async () => {
    for (const rows of [recorded().slice(1), recorded().map((r) => ({ ...r, spokenHash: "old" })),
      recorded().map((r) => ({ ...r, durationSec: 7 }))]) {
      mocks.query.mockResolvedValue(rows);
      await expect(combatPackage()).rejects.toThrow("At least one complete");
    }
    expect(mocks.takePath).not.toHaveBeenCalled();
  });

  it("packages exactly eight selected takes and their measured manifest", async () => {
    mocks.query.mockResolvedValue(recorded());
    mocks.takePath.mockResolvedValue({ kind: "file", path: "archived.mp3" });
    mocks.readFile.mockResolvedValue(Buffer.from("recording"));
    const zip = await combatPackage();
    expect(mocks.takePath).toHaveBeenCalledTimes(8);
    expect(mocks.takePath).toHaveBeenCalledWith("quests", COMBAT_LINES[0].file, 2, "enUS");
    expect(zip.subarray(-14, -12).readUInt16LE()).toBe(10);
    expect(zip.toString()).toContain("SpokenCombatAudio/Data/Sounds.lua");
    expect(zip.toString()).toContain("SpokenCombatAudio/SpokenCombatAudio.toc");
    expect(zip.toString()).toContain("## Title: Spoken Combat Audio");
    expect(zip.toString()).toContain("local addon = ...\nSpokenCombatAudioPacks = SpokenCombatAudioPacks or {}");
    expect(zip.toString()).toContain('{ key = "01", length = 2.123, format = "mp3" }');
    expect(zip.toString()).toContain("SpokenCombatAudio/Sounds/Combat/nightelf-female-player-08.mp3");
  });

  it("packages complete sets together and omits an unfinished set", async () => {
    const nightelf = COMBAT_LINES.map((line) => ({ ...line, version: 2, duration: 2, ready: true, stale: false }));
    const dwarf = nightelf.map((line) => ({ ...line, voice: "dwarf-female-player",
      id: line.id.replace(COMBAT_VOICE, "dwarf-female-player"),
      file: line.file.replace(COMBAT_VOICE, "dwarf-female-player"),
    }));
    const spy = vi.spyOn(recordings, "combatRecordings");
    mocks.takePath.mockResolvedValue({ kind: "file", path: "archived.mp3" });
    mocks.readFile.mockResolvedValue(Buffer.from("recording"));
    try {
      spy.mockResolvedValueOnce([...nightelf, ...dwarf]);
      const complete = await combatPackage();
      expect(mocks.takePath).toHaveBeenCalledTimes(16);
      expect(complete.toString()).toContain('addon .. ":dwarf-female-player"');
      expect(complete.toString()).toContain("SpokenCombatAudio/Sounds/Combat/dwarf-female-player-08.mp3");
      mocks.takePath.mockClear();
      spy.mockResolvedValueOnce([...nightelf, ...dwarf.slice(1)]);
      const partial = await combatPackage();
      expect(mocks.takePath).toHaveBeenCalledTimes(8);
      expect(partial.toString()).not.toContain("dwarf-female-player");
    } finally { spy.mockRestore(); }
  });

  it("does not create a partial package when an archived take is unavailable", async () => {
    mocks.query.mockResolvedValue(recorded());
    mocks.takePath.mockResolvedValue({ kind: "gone" });
    await expect(combatPackage()).rejects.toThrow("Recording missing");
  });

  it("writes ZIP offsets, sizes and checksums for binary audio", () => {
    const audio = Buffer.from([0, 255, 1, 128]);
    const zip = recordingsZip([{ name: "Spoken/test.mp3", data: audio }]);
    const end = zip.subarray(-22);
    const offset = end.readUInt32LE(16);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(14)).toBe(crc32(audio));
    expect(zip.readUInt32LE(18)).toBe(audio.length);
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    expect(zip.readUInt32LE(offset + 42)).toBe(0);
    expect(zip.subarray(30 + zip.readUInt16LE(26), offset)).toEqual(audio);
  });
});

/**
 * References against the real database and a real ffmpeg: the cut, the row and the file
 * have to agree, and the hash a take records has to name exactly what was sent.
 *
 * zhTW and the narrator slot, whose row this test lifts out first and puts back after, so a
 * developer's own reference survives `pnpm test`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-references-"));
process.env.SPOKEN_QUESTS_VOICE_REFERENCES = path.join(root, "references");

const { closeDb } = await import("@/lib/db");
const { asSystem } = await import("@/lib/teams/testing");
const { FFMPEG } = await import("./merge");
const references = await import("./references");
const { fishSpeaker } = await import("@/lib/generation/speakers/fish");

const VOICE = "narrator-male";
const USER = "test-fish-references";
const LANG = "zhTW" as const;
const SETTINGS = { model: "s2.1-pro", temperature: 0.7, topP: 0.7, speed: 1 };

/**
 * Whether ffmpeg is here to cut with. Skipped where it is absent, as merge.test.ts is, so a
 * laptop without it still runs the rest.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** 25 seconds of tone, standing in for a clip on /voices. */
const source = path.join(root, "clip.wav");
let displaced: Record<string, unknown>[] = [];

beforeAll(async () => {
  if (hasFfmpeg) execFileSync(FFMPEG, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:duration=25",
    "-y",
    source,
  ]);
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified")
     values ($1, 'Test References', $2, false) on conflict ("id") do nothing`,
    [USER, `${USER}@example.invalid`],
  );
  const { rows } = await asSystem.query(
    `delete from "fish_reference" where "voice" = $1 and "lang" = $2 returning *`,
    [VOICE, LANG],
  );
  displaced = rows;
});

afterAll(async () => {
  await asSystem.query(`delete from "fish_reference" where "voice" = $1 and "lang" = $2`, [VOICE, LANG]);
  for (const row of displaced) {
    const columns = Object.keys(row);
    await asSystem.query(
      `insert into "fish_reference" (${columns.map((c) => `"${c}"`).join(", ")})
       values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
      Object.values(row),
    );
  }
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [USER]);
  await asSystem.query(`delete from "user" where "id" = $1`, [USER]);
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

describe("a window", () => {
  it.each([
    [0, 20, null],
    [5, 15, null],
    [0, 30, null],
    [0, 9.5, /10-30 seconds/],
    [0, 31, /10-30 seconds/],
    [-1, 15, /before the clip/],
    [Number.NaN, 15, /numbers/],
  ])("%s-%s", (start, end, expected) => {
    const rejected = references.rejectWindow(start, end);
    if (expected === null) expect(rejected).toBeNull();
    else expect(rejected).toMatch(expected);
  });
});

describe("the hash", () => {
  it("changes with the transcript as well as the audio", () => {
    const audio = Buffer.from("clip");
    expect(references.clipHash(audio, "a")).not.toBe(references.clipHash(audio, "b"));
    expect(references.clipHash(audio, "a")).toBe(references.clipHash(Buffer.from("clip"), "a"));
  });
});

describe.skipIf(!hasFfmpeg)("a reference", () => {
  const transcribe = vi.fn(async () => "  Well met, traveller.  ");

  it("is cut, transcribed and stored, file first", async () => {
    const saved = await references.saveReference({
      voice: VOICE,
      lang: LANG,
      sample: "clip.wav",
      sourcePath: source,
      startSec: 2,
      endSec: 14,
      userId: USER,
      transcribe,
    });

    expect(saved).toMatchObject({ voice: VOICE, lang: LANG, sample: "clip.wav", transcript: "Well met, traveller." });
    const audio = fs.readFileSync(references.referencePath(VOICE, LANG));
    expect(saved.clipHash).toBe(references.clipHash(audio, "Well met, traveller."));

    // What ffmpeg cut is the window asked for, not the clip.
    const seconds = Number(
      execFileSync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        references.referencePath(VOICE, LANG),
      ]).toString(),
    );
    expect(seconds).toBeGreaterThan(11.5);
    expect(seconds).toBeLessThan(12.5);
  });

  it("is refused when nothing was heard in it", async () => {
    await expect(
      references.saveReference({
        voice: VOICE,
        lang: LANG,
        sample: "clip.wav",
        sourcePath: source,
        startSec: 0,
        endSec: 12,
        userId: USER,
        transcribe: async () => " ",
      }),
    ).rejects.toThrow(/heard nothing/);
  });

  it("gets a new hash when its transcript is corrected", async () => {
    const before = (await references.readReference(VOICE, LANG))!;
    const after = await references.saveTranscript(VOICE, LANG, "Well met, stranger.", USER);
    expect(after?.transcript).toBe("Well met, stranger.");
    expect(after?.clipHash).not.toBe(before.clipHash);
  });

  it("is pinned to fish.audio and unpinned, and a slot with none cannot be", async () => {
    expect((await references.savePinned(VOICE, LANG, true, USER))?.pinned).toBe(true);
    expect(await references.pinnedVoices(LANG)).toContain(VOICE);
    // Pressed twice: still pinned, and logged once.
    expect((await references.savePinned(VOICE, LANG, true, USER))?.pinned).toBe(true);
    expect((await references.savePinned(VOICE, LANG, false, USER))?.pinned).toBe(false);
    expect(await references.pinnedVoices(LANG)).not.toContain(VOICE);
    expect(await references.savePinned("no-such-slot", LANG, true, USER)).toBeNull();
  });

  it("is loaded by the hash a speaker handed out, and by no other", async () => {
    const current = (await references.readReference(VOICE, LANG))!;
    const { clips: loaded, lost } = await references.loadReferences(LANG, [current.clipHash, "stale"]);
    expect(lost).toEqual([]);
    expect([...loaded.keys()]).toEqual([current.clipHash]);
    expect(loaded.get(current.clipHash)?.text).toBe("Well met, stranger.");
  });
});

describe.skipIf(!hasFfmpeg)("fish.audio as a speaker", () => {
  it("resolves a slot to its reference's hash", async () => {
    const speaker = fishSpeaker({ apiKey: "k", settings: SETTINGS });
    const current = (await references.readReference(VOICE, LANG))!;
    expect((await speaker.voices(LANG)).ids.get(VOICE)).toBe(current.clipHash);
    expect(speaker.missing("dwarf-male-grim")).toBe('no fish.audio reference for "dwarf-male-grim"');
  });

  it("sends the reference it resolved, and records what it was made with", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("ID3fish", { status: 200, headers: { "content-type": "audio/mpeg" } }),
    );
    const speaker = fishSpeaker({
      apiKey: "k",
      baseUrl: "https://stub.invalid",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      settings: SETTINGS,
    });
    const voiceId = (await speaker.voices(LANG)).ids.get(VOICE)!;

    const spoken = await speaker.speak({ turns: [{ text: "你好", voiceId }], lang: LANG, seed: 7, dialogue: false });
    expect(spoken.ok).toBe(true);
    if (!spoken.ok) return;
    expect(spoken.made).toMatchObject({ modelId: "s2.1-pro", dictionaryVersion: null });
    expect(spoken.credits).toBeNull();
    // Six UTF-8 bytes at $15 a million.
    expect(spoken.costUsd).toBeCloseTo((6 * 15) / 1_000_000);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails one line, not the batch, for a hash re-cut in the meantime, and sends nothing", async () => {
    const fetchImpl = vi.fn();
    const speaker = fishSpeaker({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      settings: SETTINGS,
    });
    const spoken = await speaker.speak({
      turns: [{ text: "x", voiceId: "stale" }],
      lang: LANG,
      seed: null,
      dialogue: false,
    });
    expect(spoken.ok || [spoken.failure.kind, spoken.failure.fatal]).toEqual(["upstream", false]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops the batch, naming the slot, when a current reference's clip is gone from disk", async () => {
    const fetchImpl = vi.fn();
    const speaker = fishSpeaker({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
      settings: SETTINGS,
    });
    // A new transcript is a new hash, which no earlier case has read into the cache.
    const current = (await references.saveTranscript(VOICE, LANG, "Well met, again.", USER))!;
    const file = references.referencePath(VOICE, LANG);
    const kept = fs.readFileSync(file);
    fs.rmSync(file);
    try {
      const spoken = await speaker.speak({
        turns: [{ text: "x", voiceId: current.clipHash }],
        lang: LANG,
        seed: null,
        dialogue: false,
      });
      expect(spoken.ok || [spoken.failure.kind, spoken.failure.fatal]).toEqual(["voice-missing", true]);
      expect(spoken.ok || spoken.failure.message).toContain(`"${VOICE}"`);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      fs.writeFileSync(file, kept);
    }
  });

  it("is gone once deleted, file and all", async () => {
    await references.deleteReference(VOICE, LANG, USER);
    expect(await references.readReference(VOICE, LANG)).toBeNull();
    expect(fs.existsSync(references.referencePath(VOICE, LANG))).toBe(false);
  });

  it("logs each change under who made it, and not the ones that changed nothing", async () => {
    // A second delete finds no row, and the refused cut above never stored one.
    await references.deleteReference(VOICE, LANG, USER);
    const { rows } = await asSystem.query<{ kind: string }>(
      `select "kind" from "activity"
        where "actorId" = $1 and "subject" = $2 and "lang" = $3 order by "id"`,
      [USER, VOICE, LANG],
    );
    expect(rows.map((row) => row.kind)).toEqual([
      "reference.set",
      "reference.edited",
      "reference.pinned",
      "reference.unpinned",
      "reference.edited",
      "reference.deleted",
    ]);
  });
});

/**
 * The probe's verdicts, read from canned ffprobe output, and then from real files where
 * ffmpeg is installed to make them -- what is accepted is a claim about bytes, and the
 * canned output is only as right as the guess at what ffprobe prints.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { probeRecording, readProbe } from "./probe";

const audio = (codec: string) => [{ codec_type: "audio", codec_name: codec }];

describe("readProbe", () => {
  it("accepts mp3 and Ogg Vorbis, with their measured length", () => {
    expect(readProbe({ format: { format_name: "mp3", duration: "2.0004" }, streams: audio("mp3") })).toEqual({
      format: "mp3",
      durationSec: 2,
    });
    expect(readProbe({ format: { format_name: "ogg", duration: "1.5" }, streams: audio("vorbis") })).toEqual({
      format: "ogg",
      durationSec: 1.5,
    });
  });

  it("refuses Opus in an Ogg, which WoW cannot play", () => {
    expect(readProbe({ format: { format_name: "ogg", duration: "1" }, streams: audio("opus") })).toEqual({
      error: "is Ogg opus; only Ogg Vorbis plays in WoW",
    });
  });

  it("refuses what is not mp3 or Ogg, whatever it is called", () => {
    expect(readProbe({ format: { format_name: "wav", duration: "1" }, streams: audio("pcm_s16le") })).toHaveProperty("error");
  });

  it("refuses a click and a whole session", () => {
    expect(readProbe({ format: { format_name: "mp3", duration: "0.1" }, streams: audio("mp3") })).toHaveProperty("error");
    expect(readProbe({ format: { format_name: "mp3", duration: "900" }, streams: audio("mp3") })).toHaveProperty("error");
  });

  it("refuses a file with no audio in it", () => {
    expect(readProbe({ format: { format_name: "mp3", duration: "1" }, streams: [] })).toEqual({
      error: "has no audio in it",
    });
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recording-probe-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** One second of tone in `codec`, written to `name`. */
function tone(name: string, codec: string[]): string {
  const out = path.join(dir, name);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", ...codec, "-y", out]);
  return out;
}

describe.skipIf(!hasFfmpeg)("probeRecording", () => {
  it("knows an mp3 and an Ogg Vorbis file by their bytes, not their names", async () => {
    const mp3 = tone("a.mp3", ["-c:a", "libmp3lame"]);
    const ogg = tone("b.ogg", ["-ac", "2", "-c:a", "vorbis", "-strict", "-2"]);
    const disguised = path.join(dir, "c.ogg");
    fs.copyFileSync(mp3, disguised);

    expect(await probeRecording(mp3)).toMatchObject({ format: "mp3" });
    expect(await probeRecording(ogg)).toMatchObject({ format: "ogg" });
    expect(await probeRecording(disguised)).toMatchObject({ format: "mp3" });
  });

  it("refuses a WAV and a file that is not audio at all", async () => {
    const wav = tone("d.wav", []);
    const junk = path.join(dir, "e.mp3");
    fs.writeFileSync(junk, "not audio");

    expect(await probeRecording(wav)).toHaveProperty("error");
    expect(await probeRecording(junk)).toEqual({ error: "is not an audio file ffprobe can read" });
  });
});

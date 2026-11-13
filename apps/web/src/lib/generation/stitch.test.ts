import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stitchMp3 } from "./stitch";

const run = promisify(execFile);

// Probed at module load: skipIf is evaluated while tests are collected, before any hook.
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-stitch-test-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function sine(seconds: number, frequency: number): Promise<Buffer> {
  const clip = path.join(dir, `sine-${frequency}.mp3`);
  await run("ffmpeg", [
    "-v", "error", "-f", "lavfi", "-t", String(seconds), "-i", `sine=frequency=${frequency}:r=44100`,
    "-ac", "1", "-c:a", "libmp3lame", "-y", clip,
  ]);
  return fs.readFile(clip);
}

async function probe(audio: Buffer) {
  const file = path.join(dir, "probe.mp3");
  await fs.writeFile(file, audio);
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=sample_rate,channels",
    "-of", "json", file,
  ]);
  const info = JSON.parse(stdout);
  return {
    duration: Number(info.format.duration),
    rate: Number(info.streams[0].sample_rate),
    channels: info.streams[0].channels,
  };
}

async function silences(audio: Buffer): Promise<number[]> {
  const file = path.join(dir, "silence.mp3");
  await fs.writeFile(file, audio);
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-i", file, "-af", "silencedetect=noise=-50dB:d=0.2", "-f", "null", "-",
  ]);
  return [...stderr.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
}

describe.skipIf(!hasFfmpeg)("stitchMp3", () => {
  it("returns a lone part untouched", async () => {
    const one = await sine(0.5, 440);
    expect(await stitchMp3([one], 0.9)).toBe(one);
  });

  it("joins the parts in one stream, a pause between each, measuring as the whole", async () => {
    const joined = await stitchMp3([await sine(1, 300), await sine(1, 400), await sine(1, 500)], 0.9);
    const info = await probe(joined);
    // Measured as the sum, which a byte-for-byte concatenation would not be: it reads as its
    // first part. mp3 frames pad each part a little, hence the tolerance.
    expect(info.duration).toBeGreaterThan(4.7);
    expect(info.duration).toBeLessThan(5.0);
    expect(info).toMatchObject({ rate: 44100, channels: 1 });

    const gaps = await silences(joined);
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.9, 1);
  });
});

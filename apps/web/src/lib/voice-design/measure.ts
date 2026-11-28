/**
 * openSMILE and librosa on the droplet, through scripts/voice_measure.py.
 *
 * Optional by design: without VOICE_ANALYSIS_PYTHON, or when the helper fails, the workbench
 * shows no measurements and everything else still works.
 */
import "server-only";

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { Measures } from "./types";

const run = promisify(execFile);

/** Three previews of a minute each take seconds; a hung helper must not hold the request. */
const TIMEOUT_MS = 120_000;

export type MeasureOptions = { python?: string; script?: string };

function locate(options?: MeasureOptions) {
  return {
    python: options ? options.python : process.env.VOICE_ANALYSIS_PYTHON,
    script: options?.script ?? process.env.VOICE_ANALYSIS_SCRIPT ?? path.join(process.cwd(), "scripts", "voice_measure.py"),
  };
}

/** A file the helper measured at all: without openSMILE or librosa, part of it is absent. */
const isMeasures = (value: unknown): value is Measures =>
  Boolean(value) &&
  typeof value === "object" &&
  !("error" in (value as object)) &&
  Object.values(value as object).some((v) => typeof v === "number");

/** Each file's measures; null when there is no helper or it failed as a whole. */
export async function measureFiles(paths: string[], options?: MeasureOptions): Promise<Map<string, Measures> | null> {
  const { python, script } = locate(options);
  if (!python || paths.length === 0) return null;
  try {
    const { stdout } = await run(python, [script, ...paths], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return new Map(Object.entries(parsed).filter((entry): entry is [string, Measures] => isMeasures(entry[1])));
  } catch (error) {
    console.error("voice measurement failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

async function withFiles<T>(clips: Buffer[], work: (paths: string[], dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-measure-"));
  try {
    const paths = await Promise.all(
      clips.map(async (clip, index) => {
        const file = path.join(dir, `${index}.mp3`);
        await fs.writeFile(file, clip);
        return file;
      }),
    );
    return await work(paths, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Measures for audio in memory, in the order given; null as measureFiles. */
export async function measureAudio(clips: Buffer[], options?: MeasureOptions): Promise<(Measures | null)[] | null> {
  if (!locate(options).python || clips.length === 0) return null;
  return withFiles(clips, async (paths) => {
    const measured = await measureFiles(paths, options);
    return measured ? paths.map((file) => measured.get(file) ?? null) : null;
  });
}

/**
 * The PNG Claude reads for What's different: each clip's spectrogram with its pitch track, then
 * their long-term spectra. Null without the helper or matplotlib, or when drawing failed.
 */
export async function viewAudio(
  clips: { reference: Buffer; live: Buffer; sample: Buffer; label: string },
  options?: MeasureOptions,
): Promise<Buffer | null> {
  const { python, script } = locate(options);
  if (!python) return null;
  return withFiles([clips.reference, clips.live, clips.sample], async (paths, dir) => {
    const out = path.join(dir, "view.png");
    try {
      const { stdout } = await run(python, [script, "--view", out, ...paths, clips.label], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 });
      const answer = JSON.parse(stdout) as { image?: boolean; error?: string };
      if (!answer.image) throw new Error(answer.error ?? "no image");
      return await fs.readFile(out);
    } catch (error) {
      console.error("voice view failed:", error instanceof Error ? error.message : error);
      return null;
    }
  });
}

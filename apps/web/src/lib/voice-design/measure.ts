/**
 * openSMILE on the droplet, through scripts/voice_measure.py.
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

const isMeasures = (value: unknown): value is Measures =>
  Boolean(value) && typeof value === "object" && typeof (value as Measures).f0Hz === "number";

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

/** Measures for audio in memory, in the order given; null as measureFiles. */
export async function measureAudio(clips: Buffer[], options?: MeasureOptions): Promise<(Measures | null)[] | null> {
  if (!locate(options).python || clips.length === 0) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-measure-"));
  try {
    const paths = await Promise.all(
      clips.map(async (clip, index) => {
        const file = path.join(dir, `${index}.mp3`);
        await fs.writeFile(file, clip);
        return file;
      }),
    );
    const measured = await measureFiles(paths, options);
    return measured ? paths.map((file) => measured.get(file) ?? null) : null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Which of several voices is pitched lowest, for "deepest" beside the previews. */
export function deepestIndex(measures: readonly (Measures | null)[]): number | null {
  let best: number | null = null;
  measures.forEach((m, index) => {
    if (m && (best === null || m.f0Hz < measures[best]!.f0Hz)) best = index;
  });
  return best;
}

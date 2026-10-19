/**
 * Word times for a take just generated, when the generator gave none.
 *
 * Every generator we call returns audio only, so each saved take is timed here by forced
 * alignment: pipelines/timings/align.py lays the text the voice was given over the audio with
 * WhisperX and prints one JSON line. The result is stored beside the take ("wordTimes", the
 * format export.py writes), and the pack builds ship it later.
 *
 * Optional by environment. WORD_TIMES_ALIGNER is the command line to run (for example
 * `python3 /srv/spoken/pipelines/timings/align.py`); unset, no take is timed and generation is
 * unchanged. A take is never held up by it: any failure, a timeout included, is a take saved
 * without times, which the captions already handle by estimating.
 */
import "server-only";

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Loading the alignment model dominates, so a slow or CPU-only host needs the room. */
const TIMEOUT_MS = 180_000;

export type WordTimes = { times: string; matched: number };

/** Runs one command; a seam for tests. */
export type Run = (
  file: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ stdout: string }>;

/** WhisperX names a language by its two letters: enUS is en, zhTW is zh. */
export function whisperxLanguage(lang: string): string {
  return lang.slice(0, 2).toLowerCase();
}

/** The command line from the environment, split on spaces, or null when no aligner is set. */
export function alignerCommand(env: string | undefined = process.env.WORD_TIMES_ALIGNER) {
  const parts = (env ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? { file: parts[0], args: parts.slice(1) } : null;
}

/** The times in the last JSON line of the aligner's output, or null if there is none. Pure. */
export function readAligned(stdout: string): WordTimes | null {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.trim().startsWith("{"));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line) as { times?: unknown; matched?: unknown };
    if (typeof parsed.times !== "string" || !parsed.times) return null;
    return { times: parsed.times, matched: Number(parsed.matched) || 0 };
  } catch {
    return null;
  }
}

/**
 * The word times of the audio at `audioPath` against `text`, or null.
 *
 * `text` is what the voice was given, before pronunciation spellings, so its words are the
 * ones the addon shows. `lang` picks WhisperX's alignment model.
 */
export async function alignTake(
  audioPath: string,
  text: string,
  lang: string,
  run: Run = (file, args, options) => execFileAsync(file, args, { ...options, encoding: "utf8" }),
  command = alignerCommand(),
): Promise<WordTimes | null> {
  if (!command || !text.trim()) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "word-times-"));
  try {
    const textFile = path.join(dir, "text.txt");
    await fs.writeFile(textFile, text, "utf8");
    const { stdout } = await run(
      command.file,
      [...command.args, "--clip", audioPath, "--text-file", textFile, "--language", whisperxLanguage(lang)],
      { timeout: TIMEOUT_MS },
    );
    return readAligned(stdout);
  } catch (error) {
    // Exit 1 is "matched too little to keep", which is an answer; the rest is worth a line.
    const code = (error as { code?: unknown }).code;
    if (code !== 1) console.warn("word times: alignment failed for", audioPath, String(error));
    return null;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

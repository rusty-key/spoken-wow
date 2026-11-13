/**
 * Joining several clips into one, with a pause between them.
 *
 * Greeting clips are a second or less each, and a clone wants a minute or more of
 * audio. Uploading fifty one-second files gives ElevenLabs no prosodic context between
 * them; joining them into a single take with a beat of silence between does.
 *
 * Runs ffmpeg rather than doing it in the browser, which means the droplet needs ffmpeg
 * installed - see deploy/README.md. Arguments are passed as an array and never through a
 * shell, and every filename comes from samplePath, which only accepts names this app
 * generated.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  displayName,
  storeSampleAs,
  storedNameFor,
  withSampleFiles,
  type Sample,
} from "./samples";

const run = promisify(execFile);

export const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
export const MIN_PAUSE_SECONDS = 0;
export const MAX_PAUSE_SECONDS = 5;
export const DEFAULT_PAUSE_SECONDS = 1;
export const MAX_MERGE_INPUTS = 100;

// 192 kbps mono is what ElevenLabs asks for as a floor; the inputs are mixed formats and
// sample rates, so they are normalised before concat rather than assumed to match.
export const OUTPUT_RATE = 44100;
export const OUTPUT_BITRATE = "192k";
const FORMAT = `aformat=sample_fmts=fltp:sample_rates=${OUTPUT_RATE}:channel_layouts=mono`;

/**
 * An ffmpeg failure as something worth showing: a missing binary said plainly, since a
 * droplet without ffmpeg would otherwise surface as a spawn error nobody can act on.
 */
export function ffmpegError(error: unknown, what: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT") && message.includes(FFMPEG)) {
    return new Error(`ffmpeg is not installed or not on PATH (looked for "${FFMPEG}")`);
  }
  return new Error(`${what} failed: ${message.slice(0, 400)}`);
}

export function rejectMerge(files: string[], pauseSeconds: number): string | null {
  if (files.length < 2) return "select at least two clips to merge";
  if (files.length > MAX_MERGE_INPUTS) return `cannot merge more than ${MAX_MERGE_INPUTS} clips`;
  if (new Set(files).size !== files.length) return "the same clip was selected twice";
  if (!Number.isFinite(pauseSeconds)) return "the pause must be a number";
  if (pauseSeconds < MIN_PAUSE_SECONDS || pauseSeconds > MAX_PAUSE_SECONDS) {
    return `the pause must be between ${MIN_PAUSE_SECONDS} and ${MAX_PAUSE_SECONDS} seconds`;
  }
  return null;
}

/**
 * Build the filter graph.
 *
 * One silence source is generated and split, rather than adding an input per gap: a
 * hundred-clip merge would otherwise open a hundred lavfi inputs to produce identical
 * audio. With no pause, the clips are simply concatenated.
 */
function filterGraph(count: number, pauseSeconds: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) parts.push(`[${i}:a]${FORMAT}[a${i}]`);

  const gaps = count - 1;
  const usesSilence = pauseSeconds > 0;
  if (usesSilence) {
    const labels = Array.from({ length: gaps }, (_, i) => `[s${i}]`).join("");
    parts.push(`[${count}:a]${FORMAT},asplit=${gaps}${labels}`);
  }

  const sequence: string[] = [];
  for (let i = 0; i < count; i++) {
    sequence.push(`[a${i}]`);
    if (usesSilence && i < gaps) sequence.push(`[s${i}]`);
  }
  const segments = usesSilence ? count + gaps : count;
  parts.push(`${sequence.join("")}concat=n=${segments}:v=0:a=1[out]`);

  return parts.join(";");
}

export async function mergeSamples(
  voice: string,
  files: string[],
  pauseSeconds: number,
): Promise<Sample> {
  // Fails before ffmpeg runs if a selected clip has been deleted meanwhile, so the error
  // names the file rather than being an ffmpeg exit code.
  return withSampleFiles(voice, files, async (inputs) => {
    const args = inputs.flatMap((input) => ["-i", input]);
    if (pauseSeconds > 0) {
      args.push("-f", "lavfi", "-t", String(pauseSeconds), "-i", `anullsrc=r=${OUTPUT_RATE}:cl=mono`);
    }
    args.push(
      "-filter_complex",
      filterGraph(inputs.length, pauseSeconds),
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      OUTPUT_BITRATE,
      "-y",
    );

    // Named after the first clip in the selection, so the merge is recognisable against the
    // source it came from rather than being one of several interchangeable "merged" files.
    const first = displayName(files[0]);
    const file = storedNameFor(`merged-${path.basename(first, path.extname(first))}.mp3`);
    // Built in the OS temp directory, not the voice directory: an ffmpeg failure must not
    // leave anything behind that a listing could pick up, even briefly.
    const scratch = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "voiceover-merge-")), file);

    let data: Buffer;
    try {
      await run(FFMPEG, [...args, scratch], { maxBuffer: 8 * 1024 * 1024 });
      data = await fs.readFile(scratch);
    } catch (error) {
      throw ffmpegError(error, "merge");
    } finally {
      await fs.rm(path.dirname(scratch), { recursive: true, force: true });
    }
    if (data.byteLength === 0) throw new Error("merge produced no output");
    return storeSampleAs(voice, file, data);
  });
}

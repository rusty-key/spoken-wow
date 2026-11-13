/**
 * Several mp3s as one, with silence between them.
 *
 * Re-encoded rather than concatenated byte for byte: a file of glued mp3s plays, but it
 * measures as its first part, because mutagen reads the first header and stops, and
 * sound_length_table.lua is built from that measurement (see tts.ts). One pass through
 * ffmpeg gives one stream and one header. The output is what fish-tts.ts asks fish.audio
 * for, 44.1 kHz at 128 kbps mono, so a joined take has the same format as a single one.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { FFMPEG, ffmpegError } from "@/lib/voices/merge";

const run = promisify(execFile);

const RATE = 44100;
const FORMAT = `aformat=sample_fmts=fltp:sample_rates=${RATE}:channel_layouts=mono`;

export async function stitchMp3(parts: Buffer[], pauseSec: number): Promise<Buffer> {
  if (parts.length === 1) return parts[0];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-stitch-"));
  try {
    const inputs = await Promise.all(
      parts.map(async (part, i) => {
        const file = path.join(dir, `${i}.mp3`);
        await fs.writeFile(file, part);
        return file;
      }),
    );
    const gaps = parts.length - 1;
    const graph = [
      ...inputs.map((_, i) => `[${i}:a]${FORMAT}[a${i}]`),
      // One silence source, split: identical gaps need not each be an input.
      `[${inputs.length}:a]${FORMAT},asplit=${gaps}${Array.from({ length: gaps }, (_, i) => `[s${i}]`).join("")}`,
      // Regrouped into whole mp3 frames (1152 samples) before the encoder. Without it some
      // joins fail with "inadequate AVFrame plane padding" from libmp3lame: seen on a
      // three-paragraph fish.audio line, every draw, though never on synthetic clips.
      inputs.map((_, i) => (i < gaps ? `[a${i}][s${i}]` : `[a${i}]`)).join("") +
        `concat=n=${inputs.length + gaps}:v=0:a=1,asetnsamples=n=1152:p=0[out]`,
    ].join(";");
    const out = path.join(dir, "out.mp3");
    await run(
      FFMPEG,
      [
        "-v", "error",
        ...inputs.flatMap((input) => ["-i", input]),
        "-f", "lavfi", "-t", String(pauseSec), "-i", `anullsrc=r=${RATE}:cl=mono`,
        "-filter_complex", graph,
        "-map", "[out]",
        "-c:a", "libmp3lame", "-b:a", "128k",
        "-y", out,
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return await fs.readFile(out);
  } catch (error) {
    // ffmpeg's own words, not the command line: the message leads with the whole command,
    // every temp path and the filter graph, and the reason would be cut off after it.
    const stderr = (error as { stderr?: string }).stderr?.trim();
    if (stderr) throw new Error(`joining the paragraphs failed: ${stderr.slice(-400)}`);
    throw ffmpegError(error, "joining the paragraphs");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

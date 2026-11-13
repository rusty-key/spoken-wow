/**
 * What an uploaded recording actually is, by asking ffprobe rather than its name.
 *
 * The name and the browser's MIME type are the uploader's claims; the pack build decodes
 * the bytes. A WAV renamed .mp3, or an Opus file in an .ogg -- which WoW cannot play -- would
 * be accepted on its name and fail weeks later in a pack build, far from whoever could fix
 * it. So the container and codec are read here, and the format a recording is stored as is
 * the one ffprobe found.
 *
 * The duration is measured for the same reason the generated takes' is: the places and readables
 * lookups ship it, and the addon stops a clip by it.
 */
import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { RecordingFormat } from "./match";

const execFileAsync = promisify(execFile);

const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

/** Shorter is a click or an empty take; longer is a whole session uploaded as one line. */
const MIN_SECONDS = 0.3;
const MAX_SECONDS = 10 * 60;

export type Probed = { format: RecordingFormat; durationSec: number } | { error: string };

type FfprobeJson = {
  format?: { format_name?: string; duration?: string };
  streams?: { codec_type?: string; codec_name?: string }[];
};

/** Which format a probe describes, or why it is not one a pack can carry. Pure, for tests. */
export function readProbe(json: FfprobeJson): Probed {
  const audio = (json.streams ?? []).filter((stream) => stream.codec_type === "audio");
  if (audio.length !== 1) {
    return { error: audio.length ? "has more than one audio stream" : "has no audio in it" };
  }
  const container = json.format?.format_name ?? "";
  const codec = audio[0].codec_name ?? "";

  let format: RecordingFormat;
  if (container === "mp3" && codec === "mp3") format = "mp3";
  else if (container === "ogg" && codec === "vorbis") format = "ogg";
  else if (container === "ogg") return { error: `is Ogg ${codec || "audio"}; only Ogg Vorbis plays in WoW` };
  else return { error: `is ${container || "an unknown format"} (${codec || "?"}), not mp3 or Ogg Vorbis` };

  const durationSec = Number(json.format?.duration);
  if (!Number.isFinite(durationSec)) return { error: "has no length ffprobe could read" };
  if (durationSec < MIN_SECONDS) return { error: `is ${durationSec.toFixed(2)}s long, too short to be a line` };
  if (durationSec > MAX_SECONDS) {
    return { error: `is ${Math.round(durationSec / 60)} minutes long; one line is at most ${MAX_SECONDS / 60}` };
  }
  return { format, durationSec: Math.round(durationSec * 1000) / 1000 };
}

export async function probeRecording(file: string): Promise<Probed> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=format_name,duration:stream=codec_type,codec_name",
      "-of", "json",
      file,
    ]));
  } catch {
    // ffprobe exits non-zero on anything it cannot open as media at all.
    return { error: "is not an audio file ffprobe can read" };
  }
  return readProbe(JSON.parse(stdout) as FfprobeJson);
}

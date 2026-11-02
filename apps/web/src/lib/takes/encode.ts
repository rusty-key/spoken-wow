/**
 * A take's clip as its pack ships it, encoded at commit so a release need not encode it again.
 *
 * The recipe must match scripts/quests/package-audio.sh's ogg-q0-44k, so a clip encoded here
 * and one encoded by the build are the same file. Best effort: a zip's build encodes whatever
 * scripts/audio/fetch-encodings.mjs does not find, and a Manager release stops on it.
 */
import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { archive, blobBytes, blobKey, sha256Of } from "@/lib/blobs/store";
import { query } from "@/lib/db";
import type { Source } from "@/lib/sections";

import { withLocalCopy } from "./bytes";

const QUESTS_PROFILE = "ogg-q0-44k";

/** Null where a pack ships the take's own bytes. */
function profileFor(source: Source): string | null {
  return source === "quests" ? QUESTS_PROFILE : null;
}

function finished(child: ChildProcess, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 300)}`)),
    );
  });
}

export type Encoders = { ffmpeg: string; oggenc: string };

/**
 * ffmpeg decodes into oggenc. The pipeline listens on both ends of the pipe: an encoder that is
 * missing or exits early leaves the decoder writing into a closed pipe, and an unheard EPIPE is
 * an uncaught exception that takes the server down. Either failing kills both.
 */
export async function encodeOgg(master: string, tools: Encoders = { ffmpeg: "ffmpeg", oggenc: "oggenc" }): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-encode-"));
  const out = path.join(dir, "clip.ogg");
  const decoder = spawn(
    tools.ffmpeg,
    ["-nostdin", "-loglevel", "error", "-f", "mp3", "-i", master, "-ac", "1", "-f", "wav", "-"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const encoder = spawn(tools.oggenc, ["-Q", "-q", "0", "-o", out, "-"], { stdio: ["pipe", "ignore", "pipe"] });
  try {
    await Promise.all([
      pipeline(decoder.stdout!, encoder.stdin!),
      finished(decoder, tools.ffmpeg),
      finished(encoder, tools.oggenc),
    ]);
    return await fs.readFile(out);
  } catch (error) {
    decoder.kill();
    encoder.kill();
    throw error;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The length the pack's table lists, as mutagen reads it: the last page's granule position over the
 * sample rate. `bytes` needs only the start and the end of the file (a page is under 64 KB).
 */
export function oggDurationSec(bytes: Buffer): number {
  if (bytes.subarray(0, 4).toString("latin1") !== "OggS") throw new Error("not an Ogg");
  const serial = bytes.readUInt32LE(14);
  const sampleRate = bytes.readUInt32LE(40);
  for (let at = bytes.lastIndexOf("OggS"); at > 0; at = bytes.lastIndexOf("OggS", at - 1)) {
    // Audio can hold these four bytes by chance; a real last page has this serial and its flag.
    if (at + 18 <= bytes.length && bytes[at + 4] === 0 && bytes[at + 5] & 4 && bytes.readUInt32LE(at + 14) === serial) {
      return Number(bytes.readBigInt64LE(at + 6)) / sampleRate;
    }
  }
  throw new Error("an Ogg with no last page");
}

export type Encoding = { encodedSha256: string; bytes: number; durationSec: number };

async function recorded(source: Source, sha256: string, profile: string): Promise<Encoding | undefined> {
  const [done] = await query<Encoding>(
    `select "encodedSha256", "bytes", "durationSec"::float8 as "durationSec" from "take_encoding"
      where "source" = $1 and "sha256" = $2 and "profile" = $3`,
    [source, sha256, profile],
  );
  return done;
}

/**
 * Never throws: what went wrong is logged, and a release lists the live takes without one. The
 * duration recorded is the Ogg's, because a release reads no clips to measure.
 */
export async function encodeForPack(source: Source, sha256: string, master: string): Promise<Encoding | null> {
  const profile = profileFor(source);
  if (!profile) return null;
  try {
    const done = await recorded(source, sha256, profile);
    if (done) return done;

    const encoded = await encodeOgg(master);
    const encodedSha256 = sha256Of(encoded);
    const durationSec = oggDurationSec(encoded);
    await archive().put(blobKey("encodings", encodedSha256), encoded, "audio/ogg");
    await query(
      `insert into "take_encoding" ("source", "sha256", "profile", "encodedSha256", "bytes", "durationSec")
       values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [source, sha256, profile, encodedSha256, encoded.byteLength, durationSec],
    );
    return { encodedSha256, bytes: encoded.byteLength, durationSec };
  } catch (error) {
    console.warn(`encoding ${source} take ${sha256.slice(0, 12)} for its pack failed:`, error);
    return null;
  }
}

/** For a take put back live, which may be older than encoding at commit. Never throws. */
export async function encodeArchivedForPack(source: Source, sha256: string): Promise<void> {
  const profile = profileFor(source);
  if (!profile) return;
  try {
    if (await recorded(source, sha256, profile)) return;
    const master = await blobBytes(blobKey("takes", sha256));
    if (!master) throw new Error("not in the archive");
    await withLocalCopy(master, "mp3", (file) => encodeForPack(source, sha256, file));
  } catch (error) {
    console.warn(`encoding ${source} take ${sha256.slice(0, 12)} for its pack failed:`, error);
  }
}

/**
 * A take's clip as its pack ships it, encoded at commit so a release need not encode it again.
 *
 * The recipe must match scripts/quests/package-audio.sh's ogg-q0-44k, so a clip encoded here
 * and one encoded by the build are the same file. Best effort: a build encodes whatever
 * scripts/audio/fetch-encodings.mjs does not find.
 */
import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { archive, blobKey, sha256Of } from "@/lib/blobs/store";
import { query } from "@/lib/db";
import type { Source } from "@/lib/sections";

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

export type Encoding = { encodedSha256: string; bytes: number; durationSec: number | null };

/**
 * Never throws: what went wrong is logged, and the build encodes what is missing. The duration
 * recorded is the master's: nothing reads an encoding's own.
 */
export async function encodeForPack(
  source: Source,
  sha256: string,
  master: string,
  durationSec: number | null,
): Promise<Encoding | null> {
  const profile = profileFor(source);
  if (!profile) return null;
  try {
    const [done] = await query<Encoding>(
      `select "encodedSha256", "bytes", "durationSec"::float8 as "durationSec" from "take_encoding"
        where "source" = $1 and "sha256" = $2 and "profile" = $3`,
      [source, sha256, profile],
    );
    if (done) return done;

    const encoded = await encodeOgg(master);
    const encodedSha256 = sha256Of(encoded);
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

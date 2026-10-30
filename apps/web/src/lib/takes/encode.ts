/**
 * A take's clip as its pack ships it, encoded at commit so a release need not encode it again.
 *
 * The recipe must match scripts/quests/package-audio.sh's ogg-q0-44k, so a clip encoded here
 * and one encoded by the build are the same file. Best effort: a build encodes whatever
 * scripts/audio/fetch-encodings.mjs does not find.
 */
import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { archive, blobKey, sha256Of, writesBlobs } from "@/lib/blobs/store";
import { query } from "@/lib/db";
import type { Source } from "@/lib/sections";
import { durationOf } from "@/lib/places/tools";

const QUESTS_PROFILE = "ogg-q0-44k";

/** Null where a pack ships the take's own bytes. */
function profileFor(source: Source): string | null {
  return source === "quests" ? QUESTS_PROFILE : null;
}

function run(command: string, args: string[], input?: NodeJS.ReadableStream) {
  const child = spawn(command, args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
  if (input) input.pipe(child.stdin!);
  const done = new Promise<void>((resolve, reject) => {
    let stderr = "";
    child.stderr!.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 300)}`)),
    );
  });
  return { child, done };
}

async function encodeOgg(master: string): Promise<{ bytes: Buffer; durationSec: number | null }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-encode-"));
  const out = path.join(dir, "clip.ogg");
  try {
    const decode = run("ffmpeg", ["-nostdin", "-loglevel", "error", "-f", "mp3", "-i", master, "-ac", "1", "-f", "wav", "-"]);
    const encode = run("oggenc", ["-Q", "-q", "0", "-o", out, "-"], decode.child.stdout!);
    await Promise.all([decode.done, encode.done]);
    return { bytes: await fs.readFile(out), durationSec: await durationOf(out).catch(() => null) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export type Encoding = { encodedSha256: string; bytes: number; durationSec: number | null };

/** Never throws: what went wrong is logged, and the build encodes what is missing. */
export async function encodeForPack(source: Source, sha256: string, master: string): Promise<Encoding | null> {
  const profile = profileFor(source);
  if (!profile || !writesBlobs()) return null;
  try {
    const [done] = await query<Encoding>(
      `select "encodedSha256", "bytes", "durationSec"::float8 as "durationSec" from "take_encoding"
        where "source" = $1 and "sha256" = $2 and "profile" = $3`,
      [source, sha256, profile],
    );
    if (done) return done;

    const encoded = await encodeOgg(master);
    const encodedSha256 = sha256Of(encoded.bytes);
    await archive().put(blobKey("encodings", encodedSha256), encoded.bytes, "audio/ogg");
    await query(
      `insert into "take_encoding" ("source", "sha256", "profile", "encodedSha256", "bytes", "durationSec")
       values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [source, sha256, profile, encodedSha256, encoded.bytes.byteLength, encoded.durationSec],
    );
    return { encodedSha256, bytes: encoded.bytes.byteLength, durationSec: encoded.durationSec };
  } catch (error) {
    console.warn(`encoding ${source} take ${sha256.slice(0, 12)} for its pack failed:`, error);
    return null;
  }
}

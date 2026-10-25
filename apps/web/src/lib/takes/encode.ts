/**
 * A take's clip as its pack ships it, encoded when the take is committed.
 *
 * Quests packs are mono Ogg Vorbis at oggenc -q 0 (scripts/quests/package-audio.sh's
 * ogg-q0-44k), and every release used to encode every clip again on the machine that built
 * it. The encoding is made once here instead, put in the archive bucket, and recorded in
 * `take_encoding` (migration 0084); scripts/audio/fetch-encodings.mjs lays them into the
 * build's cache, where package-audio.sh finds them already done.
 *
 * Best effort. A take is committed whether or not this works, and a build encodes whatever
 * it does not find, so a droplet without oggenc costs a slower release, not a lost take.
 * The recipe is the build's own -- ffmpeg decodes, oggenc encodes -- so a clip encoded here
 * and one encoded by the build are the same file.
 */
import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs/promises";

import { archive, blobKey, sha256Of, writesBlobs } from "@/lib/blobs/store";
import { query } from "@/lib/db";
import type { Source } from "@/lib/sections";
import { durationOf } from "@/lib/places/tools";

import { withLocalCopy } from "./bytes";

export const QUESTS_PROFILE = "ogg-q0-44k";

/** The profile a section's packs ship, or null where a pack ships the take's own bytes. */
export function profileFor(source: Source): string | null {
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

/** ffmpeg decodes the mp3 to mono wav, oggenc -q 0 encodes it. */
async function encodeOgg(master: string, out: string): Promise<void> {
  const decode = run("ffmpeg", ["-nostdin", "-loglevel", "error", "-f", "mp3", "-i", master, "-ac", "1", "-f", "wav", "-"]);
  const encode = run("oggenc", ["-Q", "-q", "0", "-o", out, "-"], decode.child.stdout!);
  await Promise.all([decode.done, encode.done]);
}

export type Encoding = { encodedSha256: string; bytes: number; durationSec: number | null };

/**
 * Encode one committed take for its pack, unless it already is. Never throws: what went
 * wrong is logged, and the build encodes what is missing.
 */
export async function encodeForPack(source: Source, sha256: string, data: Buffer): Promise<Encoding | null> {
  const profile = profileFor(source);
  if (!profile || !writesBlobs()) return null;
  try {
    const [done] = await query<Encoding>(
      `select "encodedSha256", "bytes", "durationSec"::float8 as "durationSec" from "take_encoding"
        where "source" = $1 and "sha256" = $2 and "profile" = $3`,
      [source, sha256, profile],
    );
    if (done) return done;

    const encoded = await withLocalCopy(data, "mp3", async (master) => {
      const out = `${master}.ogg`;
      await encodeOgg(master, out);
      const bytes = await fs.readFile(out);
      const durationSec = await durationOf(out).catch(() => null);
      return { bytes, durationSec };
    });
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

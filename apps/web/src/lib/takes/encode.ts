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

import { recordActivity } from "@/lib/activity/store";
import { archive, blobBytes, blobKey, sha256Of } from "@/lib/blobs/store";
import { ALL_TEAMS, query, queryIn } from "@/lib/db";
import type { Lang } from "@/lib/lang";
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

/** A row with no duration counts as none: a release stops on it as on a missing one. */
async function recorded(source: Source, sha256: string, profile: string): Promise<Encoding | undefined> {
  const [done] = await query<Encoding>(
    `select "encodedSha256", "bytes", "durationSec"::float8 as "durationSec" from "take_encoding"
      where "source" = $1 and "sha256" = $2 and "profile" = $3 and "durationSec" is not null`,
    [source, sha256, profile],
  );
  return done;
}

/** The live take an encoding is for, so a failure can be put where its team will see it. */
export type EncodedTake = { lang: Lang; file: string; version: number; lineId?: string | null };

/**
 * Logged on the droplet and recorded in the language's activity log: the log is where an admin
 * whose release stopped can read why, and few of them can read the droplet's.
 */
async function failed(source: Source, sha256: string, take: EncodedTake | undefined, error: unknown): Promise<void> {
  console.warn(`encoding ${source} take ${sha256.slice(0, 12)} for its pack failed:`, error);
  if (!take) return;
  await recordActivity({
    kind: "take.encode_failed",
    lang: take.lang,
    actorId: null,
    source,
    subject: take.file,
    lineId: take.lineId ?? null,
    detail: { version: take.version, error: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
  });
}

/**
 * Never throws: what went wrong is logged, and a release lists the live takes without one. The
 * duration recorded is the Ogg's, because a release reads no clips to measure.
 */
export async function encodeForPack(
  source: Source,
  sha256: string,
  master: string,
  take?: EncodedTake,
): Promise<Encoding | null> {
  const profile = profileFor(source);
  if (!profile) return null;
  try {
    const done = await recorded(source, sha256, profile);
    if (done) return done;

    const encoded = await encodeOgg(master);
    const encodedSha256 = sha256Of(encoded);
    const durationSec = oggDurationSec(encoded);
    await archive().put(blobKey("encodings", encodedSha256), encoded, "audio/ogg");
    // A row with no duration never shipped from the Manager, whose release stops on it, so
    // replacing its Ogg re-downloads nothing.
    await query(
      `insert into "take_encoding" ("source", "sha256", "profile", "encodedSha256", "bytes", "durationSec")
       values ($1, $2, $3, $4, $5, $6)
       on conflict ("source", "sha256", "profile") do update
          set "encodedSha256" = excluded."encodedSha256", "bytes" = excluded."bytes", "durationSec" = excluded."durationSec"
        where "take_encoding"."durationSec" is null`,
      [source, sha256, profile, encodedSha256, encoded.byteLength, durationSec],
    );
    return { encodedSha256, bytes: encoded.byteLength, durationSec };
  } catch (error) {
    await failed(source, sha256, take, error);
    return null;
  }
}

/**
 * Every live take of a language whose encoding failed at commit, encoded again before a release.
 * Encoding at commit is best effort and nothing else retries it, so one failed encode stopped
 * that language's release until someone noticed.
 *
 * Newest first, since those are the takes the release is about to send, and only for
 * `budgetMs`: this runs inside the request that starts the release, and nginx gives that
 * request 60 seconds before the page reports a failure for a release that is in fact starting.
 * Whatever is left is named by the release and encoded on the next press.
 */
export async function encodeMissingForPack(source: Source, lang: Lang, budgetMs = 30_000): Promise<void> {
  const profile = profileFor(source);
  if (!profile) return;
  const until = Date.now() + budgetMs;
  const missing = await queryIn<{ sha256: string; file: string; version: number; lineId: string | null }>(
    ALL_TEAMS,
    `select "sha256", "file", "version", "lineId" from (
       select distinct on (t."sha256") t."sha256", t."file", t."version", t."lineId", t."createdAt"
         from "take" t
         left join "take_encoding" e
           on e."source" = t."source" and e."sha256" = t."sha256" and e."profile" = $3
        where t."source" = $1 and t."lang" = $2 and t."isCurrent" and t."sha256" is not null
          and t."teamId" = team_of_lang($2)
          and (e."id" is null or e."durationSec" is null)
        order by t."sha256", t."createdAt" desc
     ) live
     order by "createdAt" desc
     limit 500`,
    [source, lang, profile],
  );
  for (const { sha256, ...take } of missing) {
    if (Date.now() >= until) break;
    await encodeArchivedForPack(source, sha256, { lang, ...take });
  }
}

/** For a take put back live, which may be older than encoding at commit. Never throws. */
export async function encodeArchivedForPack(source: Source, sha256: string, take?: EncodedTake): Promise<void> {
  const profile = profileFor(source);
  if (!profile) return;
  try {
    if (await recorded(source, sha256, profile)) return;
    const master = await blobBytes(blobKey("takes", sha256));
    if (!master) throw new Error("not in the archive");
    await withLocalCopy(master, "mp3", (file) => encodeForPack(source, sha256, file, take));
  } catch (error) {
    await failed(source, sha256, take, error);
  }
}

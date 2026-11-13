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

/** A stuck encoder would otherwise hold its take's lock, or a release press, forever. */
const ENCODE_TIMEOUT_MS = 60_000;

function finished(child: ChildProcess, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? signal}: ${stderr.slice(0, 300)}`)),
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
    { stdio: ["ignore", "pipe", "pipe"], timeout: ENCODE_TIMEOUT_MS },
  );
  const encoder = spawn(tools.oggenc, ["-Q", "-q", "0", "-o", out, "-"], {
    stdio: ["pipe", "ignore", "pipe"],
    timeout: ENCODE_TIMEOUT_MS,
  });
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

/**
 * A row with no length counts as none, and so does a zero length: scripts/audio/sounds.mjs stops
 * a release on either.
 */
async function recorded(source: Source, sha256: string, profile: string): Promise<Encoding | undefined> {
  const [done] = await query<Encoding>(
    `select "encodedSha256", "bytes", "durationSec"::float8 as "durationSec" from "take_encoding"
      where "source" = $1 and "sha256" = $2 and "profile" = $3 and "durationSec" > 0`,
    [source, sha256, profile],
  );
  return done;
}

/** The live take an encoding is for, so a failure can be put where its team will see it. */
export type EncodedTake = { lang: Lang; file: string; version: number; lineId?: string | null };

const FAILED = "take.encode_failed";

/**
 * Logged on the droplet and recorded in the language's activity log: the log is where an admin
 * whose release stopped can read why, and few of them can read the droplet's. The same failure
 * of the same take within a day is one row, so pressing release again does not fill the log.
 */
async function failed(source: Source, sha256: string, take: EncodedTake | undefined, error: unknown): Promise<void> {
  console.warn(`encoding ${source} take ${sha256.slice(0, 12)} for its pack failed:`, error);
  if (!take) return;
  // ffmpeg names its input, a fresh temporary file each time, and its decoder's address, which
  // would make every repeat of one failure look new.
  const message = (error instanceof Error ? error.message : String(error))
    .split(os.tmpdir())
    .map((part, i) => (i === 0 ? part : part.replace(/^[^\s:]*/, "<clip>")))
    .join("")
    .replace(/ @ 0x[0-9a-f]+/g, "")
    .slice(0, 500);
  try {
    const [seen] = await queryIn(
      ALL_TEAMS,
      `select 1 from "activity"
        where "lang" = $1 and "at" > now() - interval '1 day' and "kind" = $2
          and "subject" = $3 and "detail"->>'version' = $4 and "detail"->>'error' = $5
        limit 1`,
      [take.lang, FAILED, take.file, String(take.version), message],
    );
    if (seen) return;
  } catch {
    // Better a repeated row than none.
  }
  await recordActivity({
    kind: FAILED,
    lang: take.lang,
    actorId: null,
    source,
    subject: take.file,
    lineId: take.lineId ?? null,
    detail: { version: take.version, error: message },
  });
}

/**
 * Encodes and records, with no look first. Returns the encoding the table holds, which is another
 * caller's when one encoding the same bytes recorded first: oggenc's output differs every run.
 */
async function encodeAndRecord(source: Source, sha256: string, profile: string, master: string): Promise<Encoding> {
  const encoded = await encodeOgg(master);
  const durationSec = oggDurationSec(encoded);
  if (!(durationSec > 0)) throw new Error("the Ogg has no length: the take may hold no audio");
  const encodedSha256 = sha256Of(encoded);
  await archive().put(blobKey("encodings", encodedSha256), encoded, "audio/ogg");
  // A row with no length never shipped from the Manager, whose release stops on it, so replacing
  // its Ogg makes no player download anything again.
  const [kept] = await query<Encoding>(
    `insert into "take_encoding" ("source", "sha256", "profile", "encodedSha256", "bytes", "durationSec")
     values ($1, $2, $3, $4, $5, $6)
     on conflict ("source", "sha256", "profile") do update
        set "encodedSha256" = excluded."encodedSha256", "bytes" = excluded."bytes", "durationSec" = excluded."durationSec"
      where coalesce("take_encoding"."durationSec", 0) <= 0
     returning "encodedSha256", "bytes", "durationSec"::float8 as "durationSec"`,
    [source, sha256, profile, encodedSha256, encoded.byteLength, durationSec],
  );
  const done = kept ?? (await recorded(source, sha256, profile));
  if (!done) throw new Error("its encoding was neither recorded nor found");
  return done;
}

/** Long enough for a passing blip in the bucket, the database or the one CPU to clear. */
const RETRY_AFTER_MS = 2_000;

/**
 * Never throws: what went wrong is logged, and a release lists the live takes without one. The
 * duration recorded is the Ogg's, because a release reads no clips to measure. Tried twice,
 * because a failure here is otherwise only found when a release stops on it.
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
  } catch (error) {
    await failed(source, sha256, take, error);
    return null;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await encodeAndRecord(source, sha256, profile, master);
    } catch (error) {
      if (attempt >= 2) {
        await failed(source, sha256, take, error);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
    }
  }
}

/** The master from the archive, encoded. Never throws. */
async function encodeFromArchive(source: Source, sha256: string, take?: EncodedTake): Promise<void> {
  try {
    const master = await blobBytes(blobKey("takes", sha256));
    if (!master) throw new Error("its audio is not in the archive's bucket: regenerate the line");
    await withLocalCopy(master, "mp3", (file) => encodeForPack(source, sha256, file, take));
  } catch (error) {
    await failed(source, sha256, take, error);
  }
}

/**
 * Every live take of a language with no usable encoding, encoded before a release, which stops on
 * any such take. Encoding at commit is best effort, and only a release would otherwise find a
 * failure.
 *
 * This runs inside the request that starts the release, and nginx gives that request 60 seconds
 * before the page reports a failure for a release that is in fact starting. So it waits at most
 * `budgetMs` in all, even for one slow encode, which carries on alone and records itself when it
 * finishes. Newest first, since those are the takes the release is about to send, and a take that
 * failed in the past day last, so a take that will never encode does not spend every press's time.
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
          and coalesce(e."durationSec", 0) <= 0
        order by t."sha256", t."createdAt" desc
     ) live
     order by exists (select 1 from "activity" a
                       where a."lang" = $2 and a."at" > now() - interval '1 day' and a."kind" = $4
                         and a."subject" = live."file" and a."detail"->>'version' = live."version"::text),
              "createdAt" desc
     limit 500`,
    [source, lang, profile, FAILED],
  );
  for (const { sha256, ...take } of missing) {
    const left = until - Date.now();
    if (left <= 0) return;
    let timer: NodeJS.Timeout | undefined;
    const outOfTime = new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), left)));
    const result = await Promise.race([encodeFromArchive(source, sha256, { lang, ...take }), outOfTime]);
    clearTimeout(timer);
    if (result === "late") return;
  }
}

/** For a take put back live, which may be older than encoding at commit. Never throws. */
export async function encodeArchivedForPack(source: Source, sha256: string, take?: EncodedTake): Promise<void> {
  const profile = profileFor(source);
  if (!profile) return;
  try {
    if (await recorded(source, sha256, profile)) return;
  } catch (error) {
    await failed(source, sha256, take, error);
    return;
  }
  await encodeFromArchive(source, sha256, take);
}

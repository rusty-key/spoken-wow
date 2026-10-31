/**
 * The clip each voice slot is spoken from on fish.audio, per language.
 *
 * fish.audio is used zero-shot: every request carries 10-30 seconds of the voice and exactly
 * what is said in it. So a reference is a window cut from one of the slot's clips on
 * /voices, a transcript of that window, and a row in fish_reference (migration 0042) saying
 * which clip and where. Nothing is created in anybody's fish.audio account, which is why a
 * reference made by one admin works with every collaborator's key.
 *
 * The transcript matters as much as the audio -- fish.audio's guidance is that it must match
 * exactly, punctuation included -- so it is fish.audio's own speech-to-text, open to
 * correction by hand.
 */
import "server-only";

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { recordActivity } from "@/lib/activity/store";
import { blobBytes, blobKey, blobOrFile, keep, readsBlobs, type Stored } from "@/lib/blobs/store";
import { db } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { VOICE_REFERENCES_DIR } from "@/lib/paths";

import { FFMPEG, ffmpegError, OUTPUT_BITRATE, OUTPUT_RATE } from "./merge";
import { rejectWindow } from "./reference-window";
import { isVoiceSlot } from "./slots";

const run = promisify(execFile);

export { rejectWindow } from "./reference-window";

export type Reference = {
  voice: string;
  lang: Lang;
  sample: string;
  startSec: number;
  endSec: number;
  transcript: string;
  clipHash: string;
  /** Always spoken by fish.audio in this language, whichever generator the collaborator chose. */
  pinned: boolean;
  /** Null for a clip only on the volume. */
  sha256: string | null;
  updatedAt: string;
};

/**
 * Of the clip and the transcript together: a new transcript for the same audio is a
 * different reference, because fish.audio clones from both.
 */
export function clipHash(audio: Buffer, transcript: string): string {
  return crypto.createHash("sha256").update(audio).update("\0").update(transcript).digest("hex");
}

export function referencePath(voice: string, lang: Lang): string {
  return path.join(VOICE_REFERENCES_DIR, lang, `${voice}.mp3`);
}

type Row = Omit<Reference, "updatedAt" | "lang"> & { lang: string; updatedAt: Date };

function fromRow(row: Row): Reference {
  return { ...row, lang: row.lang as Lang, updatedAt: row.updatedAt.toISOString() };
}

const COLUMNS = `"voice", "lang", "sample", "startSec", "endSec", "transcript", "clipHash", "pinned", "sha256", "updatedAt"`;

export async function readReferenceAudio(
  voice: string,
  lang: Lang,
  sha256: string | null,
): Promise<Buffer | null> {
  if (readsBlobs()) return sha256 ? blobBytes(blobKey("references", sha256)) : null;
  return fs.readFile(referencePath(voice, lang)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

/** In r2 mode a row with no hash has no clip, whatever the volume still holds. */
export function referenceClip(reference: Reference): Stored {
  return blobOrFile("references", reference.sha256, readsBlobs() ? null : referencePath(reference.voice, reference.lang));
}

export async function readReference(voice: string, lang: Lang): Promise<Reference | null> {
  const { rows } = await db().query<Row>(
    `select ${COLUMNS} from "fish_reference" where "voice" = $1 and "lang" = $2`,
    [voice, lang],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/**
 * Every reference in one language, by voice.
 *
 * Memoised for a minute, as ElevenLabs' roster is (lib/generation/status.ts): a batch asks
 * once per line for an answer that only changes when somebody cuts a reference, and every
 * write below clears it. The promise is cached, so lines starting together share one query.
 */
const LIST_TTL_MS = 60_000;
const lists = new Map<Lang, { at: number; value: Promise<Map<string, Reference>> }>();

/**
 * Drop a language's memoised list, so the next line reads the references afresh. For a
 * speaker that met a hash the list no longer matches: the edit may have been made in the
 * other app process, whose own writes clear only its own memo.
 */
export function forgetReferences(lang: Lang): void {
  lists.delete(lang);
}

export function listReferences(lang: Lang): Promise<Map<string, Reference>> {
  const cached = lists.get(lang);
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.value;
  const value = db()
    .query<Row>(`select ${COLUMNS} from "fish_reference" where "lang" = $1`, [lang])
    .then(({ rows }) => new Map(rows.map((row) => [row.voice, fromRow(row)])));
  // A failed read is not remembered: the next line asks again.
  value.catch(() => lists.delete(lang));
  lists.set(lang, { at: Date.now(), value });
  return value;
}

/** The slots spoken by fish.audio in `lang` whoever generates: the pinned references. */
export async function pinnedVoices(lang: Lang): Promise<Set<string>> {
  const references = await listReferences(lang);
  return new Set([...references.values()].filter((ref) => ref.pinned).map((ref) => ref.voice));
}

/**
 * Clips by hash, read once. Safe to keep for as long as the process lives, because the hash
 * is of the clip and its transcript: a re-cut reference is a different hash, never a changed
 * entry. A few dozen slots, a few languages, half a megabyte each.
 */
const clips = new Map<string, { audio: Buffer; text: string }>();

/**
 * The clip and transcript a request sends, found by the hash a Speaker handed out.
 *
 * By hash rather than by voice: the hash is what `voices()` resolved and what the take will
 * record, so a reference re-cut between the two must fail the request rather than send
 * different audio from what the take claims.
 */
export type LoadedReferences = {
  clips: Map<string, { audio: Buffer; text: string }>;
  /** Slots whose row is current but whose cut clip is not on disk: a lost directory. */
  lost: string[];
};

export async function loadReferences(lang: Lang, hashes: string[]): Promise<LoadedReferences> {
  const { rows } = await db().query<{ voice: string; transcript: string; clipHash: string; sha256: string | null }>(
    `select "voice", "transcript", "clipHash", "sha256" from "fish_reference"
      where "lang" = $1 and "clipHash" = any($2::text[])`,
    [lang, hashes],
  );
  type Outcome = { hash: string; clip: { audio: Buffer; text: string } } | { lost: string } | null;
  const loaded = await Promise.all(
    rows.map(async (row): Promise<Outcome> => {
      const cached = clips.get(row.clipHash);
      if (cached) return { hash: row.clipHash, clip: cached };
      const audio = await readReferenceAudio(row.voice, lang, row.sha256);
      if (!audio) return { lost: row.voice };
      // Checked against the hash before it is kept: the file is written before the row, so
      // a re-cut in progress can leave new audio beside an old row for a moment, and that
      // must fail the line rather than be sent under the old hash.
      if (clipHash(audio, row.transcript) !== row.clipHash) return null;
      const clip = { audio, text: row.transcript };
      clips.set(row.clipHash, clip);
      return { hash: row.clipHash, clip };
    }),
  );
  const result: LoadedReferences = { clips: new Map(), lost: [] };
  for (const entry of loaded) {
    if (!entry) continue;
    if ("clip" in entry) result.clips.set(entry.hash, entry.clip);
    else result.lost.push(entry.lost);
  }
  return result;
}

/**
 * Cut `startSec`-`endSec` out of `source` as mono mp3.
 *
 * Re-encoded rather than stream-copied: a copy can only cut at frame boundaries and keeps
 * whatever format the clip arrived in, and fish.audio takes WAV, MP3 and FLAC only. Arguments
 * go to ffmpeg as an array, never through a shell.
 */
export async function cutClip(source: string, startSec: number, endSec: number): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spoken-reference-"));
  const out = path.join(dir, "reference.mp3");
  try {
    await run(
      FFMPEG,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        String(startSec),
        "-t",
        String(endSec - startSec),
        "-i",
        source,
        "-ac",
        "1",
        "-ar",
        String(OUTPUT_RATE),
        "-b:a",
        OUTPUT_BITRATE,
        "-y",
        out,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    ).catch((error: unknown) => {
      throw ffmpegError(error, "cutting the reference");
    });
    const audio = await fs.readFile(out);
    if (audio.byteLength === 0) throw new Error("ffmpeg produced an empty clip");
    return audio;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export type SaveReference = {
  voice: string;
  lang: Lang;
  sample: string;
  /** The clip on disk the window is cut from. */
  sourcePath: string;
  startSec: number;
  endSec: number;
  userId: string;
  /** fish.audio's speech-to-text, bound to the admin's own key by the caller. */
  transcribe: (audio: Buffer) => Promise<string>;
};

/**
 * Cut, transcribe and store a reference, replacing any the slot already had in `lang`.
 *
 * The file is written before the row, so a row never names audio that is not there; a
 * failure between the two leaves a file nothing points at, which the next save overwrites.
 */
export async function saveReference(input: SaveReference): Promise<Reference> {
  if (!(await isVoiceSlot(input.voice))) throw new Error(`unknown voice slot ${input.voice}`);
  const rejected = rejectWindow(input.startSec, input.endSec);
  if (rejected) throw new Error(rejected);

  const audio = await cutClip(input.sourcePath, input.startSec, input.endSec);
  const transcript = (await input.transcribe(audio)).trim();
  if (!transcript) throw new Error("fish.audio heard nothing in that window");

  const sha256 = await keep("references", audio, "audio/mpeg", referencePath(input.voice, input.lang));
  await db().query(
    `insert into "fish_reference"
       ("voice", "lang", "sample", "startSec", "endSec", "transcript", "clipHash", "updatedBy", "updatedAt", "sha256")
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
     on conflict ("voice", "lang") do update set
       "sample" = excluded."sample",
       "startSec" = excluded."startSec",
       "endSec" = excluded."endSec",
       "transcript" = excluded."transcript",
       "clipHash" = excluded."clipHash",
       "updatedBy" = excluded."updatedBy",
       "sha256" = excluded."sha256",
       "updatedAt" = now()`,
    [
      input.voice,
      input.lang,
      input.sample,
      input.startSec,
      input.endSec,
      transcript,
      clipHash(audio, transcript),
      input.userId,
      sha256,
    ],
  );
  lists.delete(input.lang);
  // Cutting one changes what every fish.audio line in the language is spoken from, so who
  // cut it and from which clip is worth a row; after the upsert, which has no transaction.
  await recordActivity({
    kind: "reference.set",
    lang: input.lang,
    actorId: input.userId,
    subject: input.voice,
    detail: { sample: input.sample, transcript },
  });
  return (await readReference(input.voice, input.lang))!;
}

/** A corrected transcript, which is a new reference as far as the hash is concerned. */
export async function saveTranscript(
  voice: string,
  lang: Lang,
  transcript: string,
  userId: string,
): Promise<Reference | null> {
  const text = transcript.trim();
  if (!text) throw new Error("a transcript cannot be empty");
  const current = await readReference(voice, lang);
  if (!current) return null;
  const audio = await readReferenceAudio(voice, lang, current.sha256).catch(() => null);
  if (!audio) return null;

  const { rowCount } = await db().query(
    `update "fish_reference"
        set "transcript" = $3, "clipHash" = $4, "updatedBy" = $5, "updatedAt" = now()
      where "voice" = $1 and "lang" = $2`,
    [voice, lang, text, clipHash(audio, text), userId],
  );
  lists.delete(lang);
  if (!rowCount) return null;
  await recordActivity({
    kind: "reference.edited",
    lang,
    actorId: userId,
    subject: voice,
    detail: { transcript: text },
  });
  return readReference(voice, lang);
}

/** Pin a slot to fish.audio in `lang`, or unpin it. Null when the slot has no reference. */
export async function savePinned(
  voice: string,
  lang: Lang,
  pinned: boolean,
  userId: string,
): Promise<Reference | null> {
  const { rowCount } = await db().query(
    `update "fish_reference" set "pinned" = $3, "updatedBy" = $4, "updatedAt" = now()
      where "voice" = $1 and "lang" = $2 and "pinned" <> $3`,
    [voice, lang, pinned, userId],
  );
  lists.delete(lang);
  // Only on a change, so pressing it twice is not logged twice. It moves every line of the
  // slot from one bill to another, which is why it is logged at all.
  if (rowCount) {
    await recordActivity({
      kind: pinned ? "reference.pinned" : "reference.unpinned",
      lang,
      actorId: userId,
      subject: voice,
      detail: {},
    });
  }
  return readReference(voice, lang);
}

/**
 * The row and the cut clip. The sample it was cut from stays.
 *
 * `by` is who removed it, for the activity log: the delete leaves nothing else behind.
 */
export async function deleteReference(voice: string, lang: Lang, by: string | null): Promise<void> {
  const { rowCount } = await db().query(`delete from "fish_reference" where "voice" = $1 and "lang" = $2`, [
    voice,
    lang,
  ]);
  // The object stays: it is named by its bytes, and a re-cut of the same window reuses it.
  if (!readsBlobs()) await fs.rm(referencePath(voice, lang), { force: true });
  lists.delete(lang);
  // Only when there was a row, so deleting nothing is not logged as a delete.
  if (rowCount) {
    await recordActivity({ kind: "reference.deleted", lang, actorId: by, subject: voice, detail: {} });
  }
}

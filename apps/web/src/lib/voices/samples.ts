/**
 * The clips a voice clone is built from.
 *
 * Stored at voice/samples/<race-gender>/, one directory per slot. These are kept rather
 * than discarded after cloning: an ElevenLabs voice cannot be exported, so the clips are
 * the only way to remake one — which is exactly what was lost when this project inherited
 * voices it could not reproduce.
 *
 * Limits here are ours, not the API's. ElevenLabs' own guidance is that the file count does
 * not matter and total length does: 1-2 minutes is the target and past ~3 minutes makes the
 * clone worse, not better. Duration is measured in the browser, so nothing on this side
 * needs to decode audio.
 */
import { BASE_LANG } from "@/lib/lang";
import { parseCloneName } from "./clone-name";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { blobBytes, blobKey, blobOrFile, keep, readsBlobs, writesBlobs, type Stored } from "@/lib/blobs/store";
import { query } from "@/lib/db";
import { VOICE_SAMPLES_DIR } from "@/lib/paths";
import { withLocalCopy } from "@/lib/takes/bytes";
import { isStoredSampleName } from "./names";
import { isVoiceSlot } from "./slots";

// Re-exported so server callers have one import for everything about a stored clip; the
// definitions live in names.ts because the browser needs them and cannot load this module.
export { displayName, isStoredSampleName } from "./names";

export const ALLOWED_EXTENSIONS = ["mp3", "wav", "m4a", "mp4", "ogg", "flac", "webm"] as const;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_VOICE = 25;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export type Sample = { file: string; bytes: number; uploadedAt: string };

/**
 * Where one clone's clips are. `clone` is a clone's name (clone-name.ts): the slot for
 * English, whose clips stay exactly where they are, and `slot@lang` for another language,
 * whose clips sit in a directory of their own, <samples>/<lang>/<slot>. No slot is named
 * like a language code, so the two can never meet.
 */
export async function voiceDir(clone: string): Promise<string> {
  const parsed = parseCloneName(clone);
  if (!parsed || !(await isVoiceSlot(parsed.voice))) throw new Error(`unknown voice slot ${clone}`);
  return parsed.lang === BASE_LANG
    ? path.join(VOICE_SAMPLES_DIR, parsed.voice)
    : path.join(VOICE_SAMPLES_DIR, parsed.lang, parsed.voice);
}

export async function samplePath(voice: string, file: string): Promise<string> {
  if (!isStoredSampleName(file)) throw new Error(`unsafe sample name ${file}`);
  return path.join(await voiceDir(voice), file);
}

export function extensionOf(filename: string): string {
  return path.extname(filename).slice(1).toLowerCase();
}


/** Reject the upload before any of it is written, with a reason worth showing a human. */
export function rejectUpload(
  incoming: { name: string; size: number }[],
  existing: Sample[],
): string | null {
  if (incoming.length === 0) return "no files were uploaded";

  for (const file of incoming) {
    const ext = extensionOf(file.name);
    if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
      return `${file.name}: ${ext ? `.${ext} is not` : "files without an extension are not"} a supported audio format (${ALLOWED_EXTENSIONS.join(", ")})`;
    }
    if (file.size === 0) return `${file.name} is empty`;
    if (file.size > MAX_FILE_BYTES) {
      return `${file.name} is ${mib(file.size)} MiB; the limit is ${mib(MAX_FILE_BYTES)} MiB per file`;
    }
  }

  const count = existing.length + incoming.length;
  if (count > MAX_FILES_PER_VOICE) {
    return `that would be ${count} clips; the limit is ${MAX_FILES_PER_VOICE}`;
  }

  const total =
    existing.reduce((sum, s) => sum + s.bytes, 0) + incoming.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return `that would be ${mib(total)} MiB of clips; the limit is ${mib(MAX_TOTAL_BYTES)} MiB per voice`;
  }

  return null;
}

function mib(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * The stored name for an upload.
 *
 * The client's filename is kept only as a readable suffix, stripped to characters that mean
 * nothing to a filesystem; the random prefix is what makes the name unique, so two clips
 * called `greeting.mp3` do not collide.
 */
export function storedNameFor(originalName: string): string {
  const ext = extensionOf(originalName);
  const base = path
    .basename(originalName, path.extname(originalName))
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
  return `${crypto.randomBytes(4).toString("hex")}-${base || "clip"}.${ext}`;
}

export async function listSamples(voice: string): Promise<Sample[]> {
  if (readsBlobs()) {
    await voiceDir(voice);
    const rows = await query<{ file: string; bytes: number; uploadedAt: Date }>(
      `select "file", "bytes", "uploadedAt" from "voice_sample" where "clone" = $1
        order by "uploadedAt", "file"`,
      [voice],
    );
    return rows.map((row) => ({ ...row, uploadedAt: row.uploadedAt.toISOString() }));
  }

  const dir = await voiceDir(voice);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    // A voice with no clips yet is the normal state, not an error.
    return [];
  }

  const samples = await Promise.all(
    names.filter(isStoredSampleName).map(async (file) => {
      const stat = await fs.stat(path.join(dir, file));
      return { file, bytes: stat.size, uploadedAt: stat.mtime.toISOString() };
    }),
  );
  return samples.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
}

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

export function contentTypeOf(file: string): string {
  return CONTENT_TYPES[extensionOf(file)] ?? "application/octet-stream";
}

/** Write one clip, atomically, so a listing can never see a half-written upload. */
export async function storeSample(
  voice: string,
  originalName: string,
  data: Buffer,
): Promise<Sample> {
  return storeSampleAs(voice, storedNameFor(originalName), data);
}

export async function storeSampleAs(voice: string, file: string, data: Buffer): Promise<Sample> {
  if (!isStoredSampleName(file)) throw new Error(`unsafe sample name ${file}`);
  const dir = await voiceDir(voice);
  const sha256 = await keep("samples", data, contentTypeOf(file), path.join(dir, file));
  if (sha256) {
    await query(
      `insert into "voice_sample" ("clone", "file", "sha256", "bytes") values ($1, $2, $3, $4)
       on conflict ("clone", "file") do update set "sha256" = excluded."sha256", "bytes" = excluded."bytes"`,
      [voice, file, sha256, data.byteLength],
    );
  }

  return { file, bytes: data.byteLength, uploadedAt: new Date().toISOString() };
}

/** The object stays in the bucket: another clip may hold the same bytes. */
export async function deleteSample(voice: string, file: string): Promise<boolean> {
  if (!isStoredSampleName(file)) return false;
  await voiceDir(voice);
  let removed = false;
  if (writesBlobs()) {
    const rows = await query(`delete from "voice_sample" where "clone" = $1 and "file" = $2 returning "file"`, [
      voice,
      file,
    ]);
    removed = rows.length > 0;
  }
  if (!readsBlobs()) {
    try {
      await fs.unlink(await samplePath(voice, file));
      removed = true;
    } catch {
      // Not on the volume. In dual mode the row decides.
    }
  }
  return removed;
}

async function sampleSha(voice: string, file: string): Promise<string | null> {
  const [row] = await query<{ sha256: string }>(
    `select "sha256" from "voice_sample" where "clone" = $1 and "file" = $2`,
    [voice, file],
  );
  return row?.sha256 ?? null;
}

export async function readSample(voice: string, file: string): Promise<Buffer | null> {
  if (!isStoredSampleName(file)) return null;
  if (readsBlobs()) {
    const sha256 = await sampleSha(voice, file);
    return sha256 ? blobBytes(blobKey("samples", sha256)) : null;
  }
  return fs.readFile(await samplePath(voice, file)).catch(() => null);
}

/** In r2 mode a clip with no row is gone, whatever the volume still holds. */
export async function sampleClip(voice: string, file: string): Promise<Stored> {
  if (!readsBlobs()) return blobOrFile("samples", null, await samplePath(voice, file));
  return blobOrFile("samples", await sampleSha(voice, file), null);
}

/** ffmpeg reads files, so clips in the bucket are handed over as temporary copies. */
export async function withSampleFiles<T>(
  voice: string,
  files: string[],
  use: (paths: string[]) => Promise<T>,
): Promise<T> {
  if (!readsBlobs()) {
    const paths = await Promise.all(files.map((file) => samplePath(voice, file)));
    for (const input of paths) await fs.access(input);
    return use(paths);
  }
  const loaded: Buffer[] = [];
  for (const file of files) {
    const data = await readSample(voice, file);
    if (!data) throw new Error(`no such clip ${file}`);
    loaded.push(data);
  }
  const run = async (index: number, paths: string[]): Promise<T> =>
    index === loaded.length
      ? use(paths)
      : withLocalCopy(loaded[index], extensionOf(files[index]) || "bin", (one) => run(index + 1, [...paths, one]));
  return run(0, []);
}

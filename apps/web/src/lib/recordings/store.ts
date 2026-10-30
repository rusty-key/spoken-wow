/**
 * Voice actors' recordings: storing, listing and removing them (migration 0062).
 *
 * Kept apart from takes/ on purpose. A recording is never a version of a generated take, and
 * nothing here moves `take.isCurrent` or numbers a take: the two histories of a file run side
 * by side, and the pack build reads them separately.
 *
 * The bytes follow the take archive's rules (takes/commit.ts): written once, under a name that
 * carries their hash, before the row that names them. A crash between the two leaves an
 * unreferenced file, never a row whose file is missing.
 */
import "server-only";

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { recordActivity } from "@/lib/activity/store";
import { blobOrFile, keep } from "@/lib/blobs/store";
import { fileIndex } from "@/lib/audio";
import { catalogue as readablesCatalogue } from "@/lib/readables/catalogue";
import { db, query } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";
import { recordedDirOf } from "@/lib/takes/adapters";
import { archiveName } from "@/lib/takes/bytes";
import type { TakeBytes } from "@/lib/takes/store";
import { catalogue as placesCatalogue } from "@/lib/places/catalogue";

import { can } from "@/lib/permissions";
import { currentSession } from "@/lib/session";
import { viewerOf } from "@/lib/grants/store";

import type { LiveRecording } from "./live";
import type { RecordingFormat } from "./match";
import { probeRecording } from "./probe";

export type Recording = {
  version: number;
  format: RecordingFormat;
  durationSec: number;
  bytes: number;
  originalName: string | null;
  credit: string;
  createdAt: string;
  createdBy: string | null;
  deletedAt: string | null;
};


const COLUMNS = `"version", "format", "durationSec"::float8 as "durationSec", "bytes",
  "originalName", "credit", "createdAt", "createdBy", "deletedAt"`;

/**
 * Every file a section can address in a language, with the line it belongs to.
 *
 * The whitelist every recording route checks a file against, as takes/files.ts is for
 * takes: a path either names a file some line owns or it does not exist. Per language,
 * since a language's corpus can hold lines English does not -- contributed ones.
 */
export async function recordableFiles(source: Source, lang: Lang): Promise<Map<string, string>> {
  const corpus =
    source === "quests" ? await fileIndex(lang) : source === "places" ? await placesCatalogue(lang) : await readablesCatalogue(lang);
  // Derived once per corpus rather than per request: each of those is memoised and handed back
  // as the same object until its table moves, and every upload, play and removal asks.
  let files = derived.get(corpus);
  if (!files) {
    files =
      corpus instanceof Map
        ? new Map([...corpus].map(([file, line]) => [file, line.lineId]))
        : new Map(corpus.map((entry) => [entry.file, entry.id]));
    derived.set(corpus, files);
  }
  return files;
}

const derived = new WeakMap<object, Map<string, string>>();

/** Every recording of one file, newest first, removed ones included. */
export async function listRecordings(source: Source, lang: Lang, file: string): Promise<Recording[]> {
  return query<Recording>(
    `select ${COLUMNS} from "recording"
      where "source" = $1 and "lang" = $2 and "file" = $3
      order by "version" desc`,
    [source, lang, file],
  );
}

/** The live recording of every file in a language that has one. */
export async function liveRecordings(source: Source, lang: Lang): Promise<Map<string, LiveRecording>> {
  const rows = await query<LiveRecording & { file: string }>(
    `select distinct on ("file") "file", "version", "format", "durationSec"::float8 as "durationSec",
            "credit", "createdBy", "createdAt"
       from "recording"
      where "source" = $1 and "lang" = $2 and "deletedAt" is null
      order by "file", "version" desc`,
    [source, lang],
  );
  return new Map(rows.map(({ file, ...live }) => [file, live]));
}

/**
 * The live recordings for an explorer, or undefined for somebody who may not see them.
 *
 * Undefined rather than empty, so that a row can tell "nobody recorded this" from "you may
 * not know", and the search can drop the filter rather than answer it from nothing.
 */
export async function recordingsFor(source: Source, lang: Lang): Promise<Map<string, LiveRecording> | undefined> {
  if (!can(await viewerOf(await currentSession()), "record", lang)) return undefined;
  return liveRecordings(source, lang);
}

/**
 * Where one recording's bytes are, removed ones too, in the shape takes/serve.ts plays: a
 * recording is never "gone", only there or never made.
 */
export async function recordingPath(source: Source, lang: Lang, file: string, version: number): Promise<TakeBytes> {
  const [row] = await query<{ archiveFile: string | null; sha256: string | null }>(
    `select "archiveFile", "sha256" from "recording"
      where "source" = $1 and "lang" = $2 and "file" = $3 and "version" = $4`,
    [source, lang, file, version],
  );
  if (!row) return { kind: "none" };
  return blobOrFile("recordings", row.sha256, row.archiveFile && path.join(recordedDirOf(source, file, lang), row.archiveFile));
}

export type Upload = {
  source: Source;
  lang: Lang;
  file: string;
  /** The row it was uploaded from, or the file's own line (recordingTarget). */
  lineId: string;
  data: Buffer;
  originalName: string | null;
  credit: string;
  createdBy: string;
};

/**
 * Store an upload as the file's newest recording, which makes it the live one.
 *
 * Probed before anything is archived, from a scratch copy, so a rejected file leaves
 * nothing behind. The version is taken under a per-file advisory lock: two actors dropping
 * the same line at once would otherwise both read the same max and one insert would fail
 * on the unique key after its bytes were already written.
 */
export async function commitRecording(
  upload: Upload,
): Promise<{ recording: Recording } | { error: string }> {
  const scratch = path.join(os.tmpdir(), `spoken-recording-${randomBytes(6).toString("hex")}`);
  let probed;
  try {
    await fs.writeFile(scratch, upload.data);
    probed = await probeRecording(scratch);
  } finally {
    await fs.rm(scratch, { force: true });
  }
  if ("error" in probed) return { error: probed.error };

  const { source, lang, file } = upload;
  const { lineId } = upload;
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`recording:${source}:${lang}:${file}`]);
    const {
      rows: [{ next }],
    } = await client.query<{ next: number }>(
      `select coalesce(max("version"), 0) + 1 as "next" from "recording"
        where "source" = $1 and "lang" = $2 and "file" = $3`,
      [source, lang, file],
    );
    const name = archiveName(next, upload.data, probed.format);
    const { sha256, onDisk } = await keep(
      "recordings",
      upload.data,
      probed.format === "ogg" ? "audio/ogg" : "audio/mpeg",
      path.join(recordedDirOf(source, file, lang), name),
    );
    const archiveFile = onDisk ? name : null;
    const {
      rows: [recording],
    } = await client.query<Recording>(
      `insert into "recording"
         ("source", "lang", "file", "lineId", "version", "format", "archiveFile", "bytes",
          "durationSec", "originalName", "credit", "createdBy", "sha256")
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning ${COLUMNS}`,
      [
        source,
        lang,
        file,
        lineId,
        next,
        probed.format,
        archiveFile,
        upload.data.byteLength,
        probed.durationSec,
        upload.originalName,
        upload.credit,
        upload.createdBy,
        sha256,
      ],
    );
    await recordActivity(
      {
        kind: "recording.uploaded",
        lang,
        source,
        subject: file,
        lineId,
        actorId: upload.createdBy,
        detail: { version: next, format: probed.format, durationSec: probed.durationSec },
      },
      client,
    );
    await client.query("commit");
    return { recording };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Mark a recording removed, which hands the file back to the one before it, if any.
 *
 * Only its author or a global admin may: the route says which (`mayRemoveAny`). Returns
 * false for a version that is not there or was removed already, and for one the caller
 * may not remove, without saying which -- the route answers both with a 404.
 */
export async function removeRecording(input: {
  source: Source;
  lang: Lang;
  file: string;
  version: number;
  by: string;
  mayRemoveAny: boolean;
}): Promise<boolean> {
  const { source, lang, file, version, by } = input;
  const client = await db().connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ lineId: string | null }>(
      `update "recording" set "deletedAt" = now(), "deletedBy" = $5
        where "source" = $1 and "lang" = $2 and "file" = $3 and "version" = $4
          and "deletedAt" is null and ($6 or "createdBy" = $5)
        returning "lineId"`,
      [source, lang, file, version, by, input.mayRemoveAny],
    );
    if (rows.length === 0) {
      await client.query("rollback");
      return false;
    }
    await recordActivity(
      {
        kind: "recording.removed",
        lang,
        source,
        subject: file,
        lineId: rows[0].lineId,
        actorId: by,
        detail: { version },
      },
      client,
    );
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

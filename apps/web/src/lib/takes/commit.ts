/**
 * Committing a take, for all three sections.
 *
 * This used to be written three times -- quests in generation/history.ts, zones through the
 * pipeline's store.mjs, books in books/store.ts -- and a rule changed in one did not reach
 * the others.
 *
 * AUDIO FILES ARE WRITTEN ONCE AND NEVER CHANGED. A take is one file in the archive and one
 * row; committing adds both and touches nothing already there. There is no "store" holding
 * whichever take is live: which take is live is the row's `isCurrent`, and the addon's
 * Sounds/ folder is assembled from the live rows when a pack is built
 * (scripts/audio/sounds.mjs). So a new take cannot overwrite an old one, and there is no
 * ordering between a store and the rows for a crash to fall in the middle of.
 *
 * THE ORDER: the bytes first, under a name that includes their hash, then the row. A crash
 * between the two leaves a file no row names -- unreferenced and harmless -- never a row
 * whose file is missing. The same holds for the bucket, where the name is the whole hash.
 *
 * The caller holds the file's lock, `${source}:${file}` (generation/lock.ts), across the
 * whole generation, so that two requests for one line cannot both spend credits. Every
 * section's regeneration and the restore route take the same key.
 */
import "server-only";

import path from "node:path";

import { recordActivity } from "@/lib/activity/store";
import { keep } from "@/lib/blobs/store";
import { db, query } from "@/lib/db";
import type { Source } from "@/lib/sections";

import { BASE_LANG, type Lang } from "@/lib/lang";

import { historyDirOf } from "./adapters";
import { archiveName, withLocalCopy } from "./bytes";
import { encodeForPack } from "./encode";
import type { Provider } from "@/lib/generation/providers";

/** What a take was made with. Anything unknown is null, which means unknown, not unchanged. */
export type TakeFields = {
  lineId: string;
  voice?: string | null;
  narratorVoice?: string | null;
  voiceId?: string | null;
  modelId?: string | null;
  seed?: number | null;
  outputFormat?: string | null;
  settings?: unknown;
  characters?: number | null;
  credits?: number | null;
  /** Which generator made it. ElevenLabs when omitted, which every caller before fish was. */
  provider?: Provider;
  /** fish.audio's cost in dollars; never ElevenLabs credits. See migration 0043. */
  costUsd?: number | null;
  spokenHash?: string | null;
  dictionaryId?: string | null;
  dictionaryVersion?: string | null;
  /**
   * Whether the request carried a lead-in, and how many seconds were cut off the front.
   * True with a null length is a take that asked for one and did not get it, so it still
   * has the ramp-up in it. See lib/generation/leadin.ts. False when omitted: a take this
   * app did not cut never had one.
   */
  leadIn?: boolean;
  leadInSec?: number | null;
  createdBy?: string | null;
  /** One start per word the addon shows, in seconds (lib/generation/word-times.ts). */
  wordTimes?: number[] | null;
};

export type Committed = {
  version: number;
  bytes: number;
  /** Null when the bucket is the only store. */
  archiveFile: string | null;
  sha256: string;
  durationSec: number | null;
};

/**
 * Write a new take and make it live.
 *
 * `measure` may be handed a temporary copy that is gone once this returns.
 */
export async function commitTake(
  source: Source,
  file: string,
  data: Buffer,
  fields: TakeFields,
  options: {
    lang?: Lang;
    measure?: (clip: string) => Promise<number | null>;
    /** The queue batch this take was cut for, which the activity log folds it under. */
    batchId?: string;
  } = {},
): Promise<Committed> {
  const lang = options.lang ?? BASE_LANG;

  const [{ next }] = await query<{ next: number }>(
    `select coalesce(max("version"), 0) + 1 as "next" from "take"
      where "source" = $1 and "file" = $2 and "lang" = $3`,
    [source, file, lang],
  );

  const name = archiveName(next, data);
  const archived = path.join(historyDirOf(source, file, lang), name);
  const { sha256, onDisk } = await keep("takes", data, "audio/mpeg", archived);
  const archiveFile = onDisk ? name : null;

  const commit = async (clip: string): Promise<Committed> => {
    const durationSec = options.measure ? await options.measure(clip) : null;
    await insertLive({
      source,
      file,
      lang,
      version: next,
      fields,
      bytes: data.byteLength,
      durationSec,
      archiveFile,
      sha256,
      batchId: options.batchId,
    });
    // After the row, so the take is live even when its pack encoding fails.
    await encodeForPack(source, sha256, clip);
    return { version: next, bytes: data.byteLength, archiveFile, sha256, durationSec };
  };
  return onDisk ? commit(archived) : withLocalCopy(data, "mp3", commit);
}

/** Insert one take and make it the only live one, in one transaction. */
async function insertLive(input: {
  source: Source;
  file: string;
  lang: string;
  version: number;
  fields: TakeFields;
  bytes: number;
  durationSec: number | null;
  archiveFile: string | null;
  sha256: string;
  batchId?: string;
}): Promise<void> {
  const { source, file, lang, version, fields } = input;
  // || rather than ??: the worker passes "" for a batch whose owner's account is gone, and
  // both the take and its activity row are then nobody's.
  const createdBy = fields.createdBy || null;
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `update "take" set "isCurrent" = false
        where "source" = $1 and "file" = $2 and "lang" = $3 and "isCurrent"`,
      [source, file, lang],
    );
    // A page folded into another keeps its old file, so a readables page can have live takes under
    // two files; the new one replaces them all.
    if (source === "readables") {
      await client.query(
        `update "take" set "isCurrent" = false
          where "source" = 'readables' and "lineId" = $1 and "lang" = $2 and "isCurrent"`,
        [fields.lineId, lang],
      );
    }
    await client.query(
      `insert into "take"
         ("source", "lang", "file", "lineId", "version", "isCurrent", "origin",
          "voice", "narratorVoice", "voiceId", "modelId", "seed", "outputFormat", "settings",
          "characters", "credits", "durationSec", "bytes", "spokenHash", "dictionaryId",
          "dictionaryVersion", "leadIn", "leadInSec", "createdBy", "archiveFile",
          "provider", "costUsd", "wordTimes", "sha256")
       values ($1, $2, $3, $4, $5, true, 'generated', $6, $7, $8, $9, $10, $11, $12::jsonb,
               $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
      [
        source,
        lang,
        file,
        fields.lineId,
        version,
        fields.voice ?? null,
        fields.narratorVoice ?? null,
        fields.voiceId ?? null,
        fields.modelId ?? null,
        fields.seed ?? null,
        fields.outputFormat ?? null,
        fields.settings === undefined || fields.settings === null
          ? null
          : JSON.stringify(fields.settings),
        fields.characters ?? null,
        fields.credits ?? null,
        input.durationSec,
        input.bytes,
        fields.spokenHash ?? null,
        fields.dictionaryId ?? null,
        fields.dictionaryVersion ?? null,
        fields.leadIn ?? false,
        fields.leadInSec ?? null,
        createdBy,
        input.archiveFile,
        fields.provider ?? "elevenlabs",
        fields.costUsd ?? null,
        fields.wordTimes ?? null,
        input.sha256,
      ],
    );
    await recordActivity(
      {
        kind: "take.generated",
        lang: lang as Lang,
        source,
        subject: file,
        lineId: fields.lineId,
        actorId: createdBy,
        detail: {
          version,
          provider: fields.provider ?? "elevenlabs",
          credits: fields.credits ?? null,
          costUsd: fields.costUsd ?? null,
          ...(input.batchId ? { batchId: input.batchId } : {}),
        },
      },
      client,
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Writing an archive object: to the volume and our bucket as `SPOKEN_ARCHIVE_STORE` says, or, in
 * `r2` mode, to the bucket the owning team sends new objects to (docs/platform/STORAGE.md).
 *
 * A team's bucket that refuses a PUT is marked failing and the bytes go to `quarantine/` in ours,
 * since the provider was already paid for them; `landQuarantined` moves them on once the bucket
 * answers again. Until then the object is read from the quarantine.
 */
import "server-only";

import { ALL_TEAMS, query, queryIn, type TeamId } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { writingBackend } from "@/lib/storage/backends";
import { errorText } from "@/lib/storage/error-text";
import { writeAtomic } from "@/lib/takes/bytes";
import { teamOf } from "@/lib/teams/store";

import { archive, archiveMode, blobKey, sha256Of, type BlobPrefix } from "./store";
import { SealError } from "./seal";
import { backendStore, OBJECT_ROW, objectParams, quarantineKey } from "./where";


/** Health is the bucket's own to recover: a test, or a quarantined object that lands. */
async function markFailing(backendId: string, error: unknown): Promise<void> {
  // Our own key missing or wrong is this site's fault, not the bucket's: the team is told nothing
  // it can fix, and its work is not stopped. The object waits in the quarantine all the same.
  if (error instanceof SealError) return;
  await queryIn(
    ALL_TEAMS,
    `update "storage_backend" set "health" = 'failing', "lastError" = $2, "checkedAt" = now() where "id" = $1`,
    [backendId, `Writing an object: ${errorText(error)}`],
  );
}

/**
 * Records that `backendId`, `team`'s bucket, holds the object, or that it waits in quarantine for
 * it. A copy already in the bucket stays the one read. Returns whether the row was waiting before
 * and is now, so a quarantined copy nothing will land any more can be removed.
 */
export async function recordObject(
  prefix: BlobPrefix,
  sha256: string,
  backendId: string,
  team: TeamId,
  pending: boolean,
): Promise<{ was: boolean; now: boolean }> {
  const [row] = await query<{ was: boolean | null; now: boolean }>(
    `with "before" as (
       select "pending" from "archive_object" where ${OBJECT_ROW}
     )
     insert into "archive_object" ("prefix", "sha256", "backendId", "teamId", "pending") values ($1, $2, $3, $4, $5)
     on conflict ("prefix", "sha256", "backendId") do update
        set "pending" = $5 and ("archive_object"."pending" or "archive_object"."missingAt" is not null),
            "missingAt" = null,
            "keptAt" = now()
     returning (select "pending" from "before") as "was", "pending" as "now"`,
    [prefix, sha256, backendId, team, pending],
  );
  return { was: row?.was ?? false, now: row?.now ?? pending };
}

/** Whether `backendId` is known to hold a landed, present copy of the object. */
async function holds(prefix: BlobPrefix, sha256: string, backendId: string): Promise<boolean> {
  const rows = await query(
    `select 1 from "archive_object" where ${OBJECT_ROW} and not "pending" and "missingAt" is null`,
    objectParams(blobKey(prefix, sha256), backendId),
  );
  return rows.length > 0;
}

/** A team that must keep its audio in its own bucket has none to keep this in. The message is fit to show. */
export class OwnStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnStorageError";
  }
}

/** The bucket a team writes new objects to, with the team; null for ours. */
type Target = (NonNullable<Awaited<ReturnType<typeof writingBackend>>> & { team: TeamId }) | null;

/**
 * Where `lang`'s team keeps new objects, read once for a whole write: whether it may keep nothing
 * of ours, the bucket it writes to in r2 mode, and why it may not keep anything now, or null. A
 * team with `ownStorage` needs a bucket switched on, and that needs our archive in r2 mode.
 */
async function storageOf(lang: Lang): Promise<{ own: boolean; target: Target; refusal: string | null }> {
  const team = await teamOf(lang);
  const r2 = archiveMode() === "r2";
  const [own, backend] = await Promise.all([keepsOwnStorage(team), r2 ? writingBackend(team) : null]);
  const target = backend && { ...backend, team };
  return { own, target, refusal: own ? requiredRefusal(r2, Boolean(target)) : null };
}

function requiredRefusal(r2: boolean, hasBucket: boolean): string | null {
  if (!r2) return "This site cannot use team buckets yet, and your team keeps its audio only in its own, so nothing can be made for it.";
  if (!hasBucket) return "Your team keeps its audio in its own bucket: connect one on the Storage page and switch it on before making takes, recordings or clone clips.";
  return null;
}

/**
 * Why `lang`'s team may not keep audio now, or null. A team that may use our archive, every team
 * made before own storage, is answered with one query and no look at its buckets.
 */
export async function ownStorageRefusal(lang: Lang): Promise<string | null> {
  const team = await teamOf(lang);
  if (!(await keepsOwnStorage(team))) return null;
  const r2 = archiveMode() === "r2";
  return requiredRefusal(r2, r2 && Boolean(await writingBackend(team)));
}

type Refusal = { kind: "storage-required" | "storage-failing"; message: string };

/** The 409 a refusal is answered with, which the Regenerate dialog shows (lib/generation/client.ts). */
export const refusalResponse = ({ kind, message }: Refusal): Response =>
  Response.json({ error: message, kind }, { status: 409 });

/** The 409 a route answers before it reads an upload or pays for anything, or null when the team may keep audio. */
export async function storageRequiredResponse(lang: Lang): Promise<Response | null> {
  const message = await ownStorageRefusal(lang);
  return message ? refusalResponse({ kind: "storage-required", message }) : null;
}

/** Whether the team may keep nothing in our archive (team."ownStorage"). */
export async function keepsOwnStorage(team: TeamId): Promise<boolean> {
  const [row] = await query<{ ownStorage: boolean }>(`select "ownStorage" from "team" where "id" = $1`, [team]);
  return row?.ownStorage ?? false;
}

async function targetFor(lang: Lang): Promise<Target> {
  const { target, refusal } = await storageOf(lang);
  if (refusal) throw new OwnStorageError(refusal);
  return target;
}

/**
 * Puts the object where `lang`'s team keeps new objects. Throws when our own bucket refuses it too,
 * so the object is nowhere, and an OwnStorageError for a team that may not use ours.
 */
export async function putArchived(prefix: BlobPrefix, sha256: string, data: Buffer, contentType: string, lang: Lang): Promise<void> {
  return placeArchived(prefix, sha256, data, contentType, await targetFor(lang));
}

/** Into `target`, the team's bucket in r2 mode, or ours with none. */
async function placeArchived(prefix: BlobPrefix, sha256: string, data: Buffer, contentType: string, target: Target): Promise<void> {
  const key = blobKey(prefix, sha256);
  if (!target) return archive().put(key, data, contentType);
  let refusal: unknown = null;
  if (target.health !== "failing") {
    // Only the bucket's own refusal counts: an error recording it afterwards is ours, and throws.
    try {
      await (await backendStore(target.id)).put(key, data, contentType);
    } catch (error) {
      refusal = error;
      console.error(`storage: the team bucket ${target.id} refused ${key}, quarantined:`, error);
    }
    if (!refusal) {
      if ((await recordObject(prefix, sha256, target.id, target.team, false)).was) await dropQuarantined(target.id, key);
      return;
    }
  }
  try {
    // These same bytes already in the bucket need no copy of ours.
    if (!(await holds(prefix, sha256, target.id))) {
      await archive().put(quarantineKey(target.id, key), data, contentType);
      // A direct write of these bytes may have landed meanwhile: then nothing would land this copy.
      if (!(await recordObject(prefix, sha256, target.id, target.team, true)).now) await dropQuarantined(target.id, key);
    }
  } finally {
    // After the bytes are safe, or once our own bucket refused them too: marking the bucket failing
    // must never cost the paid-for take, and must happen even when the take is lost.
    if (refusal) await markFailing(target.id, refusal).catch((error) => console.error(`storage: could not mark ${target.id} failing:`, error));
  }
}

/**
 * Both writes have finished when this returns, so the caller's row comes after them. The hash
 * comes back only once its object is in a bucket, and is what the row records: the backfill
 * copies exactly the rows without one.
 *
 * In `dual` the volume is still the record, so a failed PUT is logged and the row is left for
 * the backfill rather than failing a take the provider was already paid for.
 */
export async function keep(
  prefix: BlobPrefix,
  data: Buffer,
  contentType: string,
  diskPath: string,
  lang: Lang,
): Promise<string | null> {
  // Before the volume too: a team with its own storage keeps nothing of ours, in any mode.
  const target = await targetFor(lang);
  const sha256 = sha256Of(data);
  const mode = archiveMode();
  const put = async () => {
    if (mode === "disk") return null;
    try {
      await placeArchived(prefix, sha256, data, contentType, target);
      return sha256;
    } catch (error) {
      if (mode === "r2") throw error;
      console.error(`archiving ${prefix}/${sha256.slice(0, 12)} failed, left for the backfill:`, error);
      return null;
    }
  };
  const [kept] = await Promise.all([put(), mode !== "r2" && writeAtomic(diskPath, data)]);
  return kept;
}

export async function dropQuarantined(backendId: string, key: string): Promise<void> {
  await archive().delete(quarantineKey(backendId, key)).catch((error) => console.error(`storage: could not delete the quarantined ${key}:`, error));
}

/** Sends a row that cannot be landed now to the back of its bucket's queue, so it holds up no other. */
async function requeue(prefix: BlobPrefix, sha256: string, backendId: string): Promise<void> {
  await query(`update "archive_object" set "keptAt" = now() where ${OBJECT_ROW}`, objectParams(blobKey(prefix, sha256), backendId));
}

/**
 * Moves up to `perBucket` quarantined objects of each bucket into it, oldest first, and deletes our
 * copy of each once it has landed. A bucket that refuses one is left for the next round, without
 * holding up another's; one that takes one is healthy again. Returns how many landed.
 */
export async function landQuarantined(perBucket = 20): Promise<number> {
  const rows = await query<{ prefix: BlobPrefix; sha256: string; backendId: string }>(
    // Each bucket's oldest few, read off archive_object_pending_idx rather than sorting them all.
    `select o."prefix", o."sha256", o."backendId"
       from (select distinct "backendId" from "archive_object" where "pending") b
      cross join lateral (
        select "prefix", "sha256", "backendId", "keptAt" from "archive_object"
         where "backendId" = b."backendId" and "pending" order by "keptAt" limit $1) o
      order by o."keptAt"`,
    [perBucket],
  );
  const refused = new Set<string>();
  const healed = new Set<string>();
  let landed = 0;
  for (const row of rows) {
    if (refused.has(row.backendId)) continue;
    const key = blobKey(row.prefix, row.sha256);
    // Our own bucket failing to give back one copy is that copy's problem, not the round's.
    let held: Awaited<ReturnType<ReturnType<typeof archive>["get"]>>;
    let data: Buffer;
    try {
      held = await archive().get(quarantineKey(row.backendId, key));
      if (!held?.body) {
        console.error(`storage: ${key} is pending but not in the quarantine`);
        await requeue(row.prefix, row.sha256, row.backendId);
        continue;
      }
      data = Buffer.from(await new Response(held.body).arrayBuffer());
    } catch (error) {
      console.error(`storage: could not read the quarantined ${key}:`, error);
      await requeue(row.prefix, row.sha256, row.backendId);
      continue;
    }
    if (sha256Of(data) !== row.sha256) {
      console.error(`storage: the quarantined ${key} does not match its hash`);
      await requeue(row.prefix, row.sha256, row.backendId);
      continue;
    }
    try {
      await (await backendStore(row.backendId)).put(key, data, held.contentType);
    } catch (error) {
      refused.add(row.backendId);
      // To the back of its bucket's queue, so one key the bucket keeps refusing heads no round.
      await requeue(row.prefix, row.sha256, row.backendId);
      await markFailing(row.backendId, error);
      continue;
    }
    await query(`update "archive_object" set "pending" = false, "missingAt" = null where ${OBJECT_ROW}`, objectParams(key, row.backendId));
    healed.add(row.backendId);
    // Only once nothing reads it from here: the row above sends every read to the team's bucket.
    await dropQuarantined(row.backendId, key);
    landed++;
  }
  // A bucket that took an object works again, unless a later one of its own was refused.
  const working = [...healed].filter((id) => !refused.has(id));
  if (working.length > 0) {
    await queryIn(
      ALL_TEAMS,
      `update "storage_backend" set "health" = 'ok', "lastError" = null, "checkedAt" = now()
        where "id" = any($1::uuid[]) and "health" = 'failing'`,
      [working],
    );
  }
  return landed;
}

/**
 * Why `lang`'s team may not queue paid work now, or null: it must keep its own storage and has
 * none, or its bucket is failing. Jobs already queued carry on, into the quarantine.
 */
export async function storageRefusal(lang: Lang): Promise<Refusal | null> {
  const { own, target, refusal } = await storageOf(lang);
  if (refusal) return { kind: "storage-required", message: refusal };
  if (target?.health !== "failing") return null;
  const instead = own ? "" : ", or send new objects to Spoken's archive";
  return { kind: "storage-failing", message: `Your team's bucket is failing, so nothing new is queued: test it on the Storage page${instead}.` };
}

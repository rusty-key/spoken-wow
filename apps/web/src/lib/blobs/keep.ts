/**
 * Writing an archive object: to the volume and our bucket as `SPOKEN_ARCHIVE_STORE` says, or, in
 * `r2` mode, to the bucket the owning team sends new objects to (docs/platform/STORAGE.md).
 *
 * A team's bucket that refuses a PUT is marked failing and the bytes go to `quarantine/` in ours,
 * since the provider was already paid for them; `landQuarantined` moves them on once the bucket
 * answers again. Until then the object is read from the quarantine.
 */
import "server-only";

import { ALL_TEAMS, query, queryIn } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { writingBackend } from "@/lib/storage/backends";
import { writeAtomic } from "@/lib/takes/bytes";
import { teamOf } from "@/lib/teams/store";

import { archive, archiveMode, blobKey, sha256Of, type BlobPrefix } from "./store";
import { SealError } from "./seal";
import { backendStore, QUARANTINE } from "./where";

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

/** Health is the bucket's own to recover: a test, or a quarantined object that lands. */
export async function markFailing(backendId: string, error: unknown): Promise<void> {
  // Our own key missing or wrong is this site's fault, not the bucket's: the team is told nothing
  // it can fix, and its work is not stopped. The object waits in the quarantine all the same.
  if (error instanceof SealError) return;
  await queryIn(
    ALL_TEAMS,
    `update "storage_backend" set "health" = 'failing', "lastError" = $2, "checkedAt" = now() where "id" = $1`,
    [backendId, `Writing an object: ${reason(error)}`],
  );
}

async function record(prefix: BlobPrefix, sha256: string, backendId: string, pending: boolean): Promise<void> {
  // A copy already in the team's bucket stays the one read, even when these same bytes wait in
  // the quarantine as well.
  await query(
    `insert into "archive_object" ("prefix", "sha256", "backendId", "pending") values ($1, $2, $3, $4)
     on conflict ("prefix", "sha256", "backendId") do update
        set "pending" = case when $4 then "archive_object"."pending" or "archive_object"."missingAt" is not null else false end,
            "missingAt" = null,
            "keptAt" = now()`,
    [prefix, sha256, backendId, pending],
  );
}

/**
 * Puts the object where `lang`'s team keeps new objects. Throws only when our own bucket refuses
 * it too, so the object is nowhere.
 */
export async function putArchived(prefix: BlobPrefix, sha256: string, data: Buffer, contentType: string, lang: Lang): Promise<void> {
  const key = blobKey(prefix, sha256);
  const target = archiveMode() === "r2" ? await writingBackend(await teamOf(lang)) : null;
  if (!target) return archive().put(key, data, contentType);
  if (target.health !== "failing") {
    try {
      await (await backendStore(target.id)).put(key, data, contentType);
      await record(prefix, sha256, target.id, false);
      return;
    } catch (error) {
      console.error(`storage: the team bucket ${target.id} refused ${key}, quarantined:`, error);
      await markFailing(target.id, error);
    }
  }
  await archive().put(`${QUARANTINE}${key}`, data, contentType);
  await record(prefix, sha256, target.id, true);
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
  const sha256 = sha256Of(data);
  const mode = archiveMode();
  const put = async () => {
    if (mode === "disk") return null;
    try {
      await putArchived(prefix, sha256, data, contentType, lang);
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

/**
 * Moves up to `limit` quarantined objects into their team's bucket, oldest first, and deletes our
 * copy of each once it has landed. A bucket that refuses one is left for the next round; one that
 * takes one is healthy again. Returns how many landed.
 */
export async function landQuarantined(limit = 100): Promise<number> {
  const rows = await query<{ prefix: BlobPrefix; sha256: string; backendId: string }>(
    `select o."prefix", o."sha256", o."backendId" from "archive_object" o
      where o."pending" order by o."keptAt" limit $1`,
    [limit],
  );
  const refused = new Set<string>();
  let landed = 0;
  for (const row of rows) {
    if (refused.has(row.backendId)) continue;
    const key = blobKey(row.prefix, row.sha256);
    const held = await archive().get(`${QUARANTINE}${key}`);
    if (!held?.body) {
      console.error(`storage: ${key} is pending but not in the quarantine`);
      continue;
    }
    const data = Buffer.from(await new Response(held.body).arrayBuffer());
    if (sha256Of(data) !== row.sha256) {
      console.error(`storage: the quarantined ${key} does not match its hash`);
      continue;
    }
    try {
      await (await backendStore(row.backendId)).put(key, data, held.contentType);
    } catch (error) {
      refused.add(row.backendId);
      await markFailing(row.backendId, error);
      continue;
    }
    await query(
      `update "archive_object" set "pending" = false, "missingAt" = null where "prefix" = $1 and "sha256" = $2 and "backendId" = $3`,
      [row.prefix, row.sha256, row.backendId],
    );
    await queryIn(
      ALL_TEAMS,
      `update "storage_backend" set "health" = 'ok', "lastError" = null, "checkedAt" = now() where "id" = $1 and "health" = 'failing'`,
      [row.backendId],
    );
    // Only once nothing reads it from here: the row above sends every read to the team's bucket.
    await archive().delete(`${QUARANTINE}${key}`).catch((error) => console.error(`storage: could not delete the quarantined ${key}:`, error));
    landed++;
  }
  return landed;
}

/** Why `lang`'s team may not queue paid work now, or null. Jobs already queued carry on, into the quarantine. */
export async function storageRefusal(lang: Lang): Promise<string | null> {
  if (archiveMode() !== "r2") return null;
  const target = await writingBackend(await teamOf(lang));
  if (target?.health !== "failing") return null;
  return "Your team's bucket is failing, so nothing new is queued: test it on the Storage page, or send new objects to Spoken's archive.";
}

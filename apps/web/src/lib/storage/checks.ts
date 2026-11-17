/**
 * A team may delete from its own bucket (docs/platform/STORAGE.md). A sample of the objects team
 * buckets should hold is looked at every round: one gone is marked missing, so reads try any other
 * copy and the storage page counts it; one back again (a restored version) is unmarked. A bucket
 * that cannot be asked at all is a health problem, not a missing object, and is left alone.
 */
import "server-only";

import { query } from "@/lib/db";
import { blobKey, type BlobPrefix } from "@/lib/blobs/store";
import { backendStore, markMissing } from "@/lib/blobs/where";

export async function checkObjects(sample = 50): Promise<{ checked: number; missing: number; back: number }> {
  const rows = await query<{ prefix: BlobPrefix; sha256: string; backendId: string; missing: boolean }>(
    `select o."prefix", o."sha256", o."backendId", o."missingAt" is not null as "missing"
       from "archive_object" o
      where not o."pending"
      order by random() limit $1`,
    [sample],
  );
  let missing = 0;
  let back = 0;
  let checked = 0;
  for (const row of rows) {
    let there: boolean;
    try {
      there = (await (await backendStore(row.backendId)).head(blobKey(row.prefix, row.sha256))) !== null;
    } catch {
      continue;
    }
    checked++;
    if (there === !row.missing) continue;
    await markMissing(blobKey(row.prefix, row.sha256), row.backendId, !there);
    if (there) back++;
    else missing++;
  }
  return { checked, missing, back };
}

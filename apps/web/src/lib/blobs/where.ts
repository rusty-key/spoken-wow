/**
 * Which bucket holds an archive object (docs/platform/STORAGE.md). An object a team kept in its own
 * bucket has an `archive_object` row naming that bucket; every other object is in ours. A row is
 * never moved: a copy adds a row, so a read finds the object wherever a copy of it is.
 */
import "server-only";

import { ALL_TEAMS, query, queryIn } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import type { RangeRequest } from "@/lib/range";
import { freshOwners } from "@/lib/teams/store";
import { listenInServer } from "@/lib/teams/listen";

import { unseal } from "./seal";
import { archive, s3Blobs, type BlobPrefix, type BlobRead, type BlobStore } from "./store";

export type Where = {
  store: BlobStore;
  /** The object's key in `store`: the archive key, or its quarantine key in ours. */
  key: string;
  /** The team bucket's id, null for ours. */
  backendId: string | null;
  /** In our quarantine for a team's bucket: read from ours, but only until it lands. */
  pending: boolean;
};

/** A PUT a team's bucket refused waits here in ours. Not a take's prefix, so the retry may delete it. */
export const QUARANTINE = "quarantine/";

/** Each bucket's waiting copies apart, so landing one bucket's copy never removes another's. */
export const quarantineKey = (backendId: string, key: string) => `${QUARANTINE}${backendId}/${key}`;

export type BackendRow = {
  id: string;
  endpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
  publicUrl: string | null;
  accessKeyId: string;
  secretSealed: string;
  conditionalPut: boolean;
};

export const BACKEND_COLUMNS = `"id", "endpoint", "region", "bucket", "pathStyle", "publicUrl", "accessKeyId", "secretSealed", "conditionalPut"`;

export function storeOfRow(row: BackendRow, secret = unseal(row.secretSealed, row.id)): BlobStore {
  return s3Blobs({
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    accessKeyId: row.accessKeyId,
    secretAccessKey: secret,
    publicUrl: row.publicUrl,
    pathStyle: row.pathStyle,
    conditionalPut: row.conditionalPut,
  });
}

const stores = new Map<string, Promise<BlobStore>>();
const overrides = new Map<string, BlobStore>();

/** Drops every built store, so the next read takes a changed key or address. */
export function forgetBackends(): void {
  stores.clear();
}

/** A team bucket's store, by id. Retired ones too: they still hold what was kept in them. */
export function backendStore(id: string): Promise<BlobStore> {
  const override = overrides.get(id);
  if (override) return Promise.resolve(override);
  listenInServer("spoken_storage_backend", forgetBackends);
  let store = stores.get(id);
  if (!store) {
    store = queryIn<BackendRow>(ALL_TEAMS, `select ${BACKEND_COLUMNS} from "storage_backend" where "id" = $1`, [id]).then(
      ([row]) => {
        if (!row) throw new Error(`no storage backend ${id}`);
        return storeOfRow(row);
      },
    );
    stores.set(id, store);
    const built = store;
    built.catch(() => {
      if (stores.get(id) === built) stores.delete(id);
    });
  }
  return store;
}

export function split(key: string): { prefix: BlobPrefix; sha256: string } {
  const slash = key.indexOf("/");
  return { prefix: key.slice(0, slash) as BlobPrefix, sha256: key.slice(slash + 1) };
}

/**
 * Where to read `key` (`<prefix>/<sha256>`). A copy not known to be missing; with `lang`, its team's
 * own copy first; one that has landed before one waiting in quarantine; the newest first. With
 * none, ours: a move never purged it, so an object older than the move is still there.
 *
 * Another team's copy is still read, since a language handed over leaves its objects in the old
 * team's bucket. So two teams that each kept the same bytes, one in our archive and one in its own
 * bucket, read the latter's. Pack builds check every object's hash; the site does not.
 */
export async function locate(key: string, lang?: Lang): Promise<Where> {
  const { prefix, sha256 } = split(key);
  const rows = await query<{ backendId: string; pending: boolean; teamId: string }>(
    `select "backendId", "pending", "teamId" from "archive_object"
      where "prefix" = $1 and "sha256" = $2 and "missingAt" is null
      order by "pending", "keptAt" desc`,
    [prefix, sha256],
  );
  let found = rows[0];
  // The team matters only between copies, which is rare: most objects have one row or none. It is
  // the acting team, where the language has several a member's own (lib/teams/acting.ts).
  if (rows.length > 1 && lang) {
    const team = (await freshOwners([lang])).get(lang);
    found = rows.find((row) => row.teamId === team) ?? found;
  }
  if (!found) return { store: archive(), key, backendId: null, pending: false };
  if (found.pending) return { store: archive(), key: quarantineKey(found.backendId, key), backendId: null, pending: true };
  return { store: await backendStore(found.backendId), key, backendId: found.backendId, pending: false };
}

/** The `archive_object` row of one object in one bucket, for `objectParams`' $1–$3. */
export const OBJECT_ROW = `"prefix" = $1 and "sha256" = $2 and "backendId" = $3`;

export function objectParams(key: string, backendId: string): [string, string, string] {
  const { prefix, sha256 } = split(key);
  return [prefix, sha256, backendId];
}

/**
 * Records whether a team's bucket still holds the object. A missing one is skipped by the next
 * read; the first time it was found missing is kept.
 */
export async function markMissing(key: string, backendId: string | null, missing = true): Promise<void> {
  if (!backendId) return;
  await query(
    missing
      ? `update "archive_object" set "missingAt" = now() where ${OBJECT_ROW} and "missingAt" is null`
      : `update "archive_object" set "missingAt" = null where ${OBJECT_ROW}`,
    objectParams(key, backendId),
  );
}

/**
 * Reads `key` from the first copy that has it. A team's copy that turns out gone is marked missing
 * and the next one tried; ours last. Null when no copy has it.
 */
export async function readLocated(
  key: string,
  range?: RangeRequest,
  lang?: Lang,
): Promise<{ where: Where; object: BlobRead } | null> {
  let relocated = false;
  for (;;) {
    const where = await locate(key, lang);
    const object = await where.store.get(where.key, range);
    if (object) return { where, object };
    // A quarantined copy is deleted once it lands: look once more, where it landed.
    if (where.pending && !relocated) {
      relocated = true;
      continue;
    }
    if (!where.backendId) return null;
    await markMissing(key, where.backendId);
  }
}

/** How long a signed address for a private bucket lasts. Anything cached that points at one must expire sooner. */
export const SIGNED_FOR_SEC = 3600;

/** Where a browser or a build fetches the object: the bucket's public address, or a signed one. */
export async function addressOf(where: Where, method: "GET" | "HEAD" = "GET"): Promise<{ url: string; signed: boolean }> {
  const url = where.store.url(where.key);
  if (url) return { url, signed: false };
  return { url: await where.store.presign(where.key, { method, expiresSec: SIGNED_FOR_SEC }), signed: true };
}

/** The whole object, wherever it is, for a caller that needs its bytes rather than a response. */
export async function blobBytes(key: string, lang?: Lang): Promise<Buffer | null> {
  const body = (await readLocated(key, undefined, lang))?.object.body;
  return body ? Buffer.from(await new Response(body).arrayBuffer()) : null;
}

export function useBackendForTests(id: string, store: BlobStore): () => void {
  overrides.set(id, store);
  return () => {
    overrides.delete(id);
  };
}

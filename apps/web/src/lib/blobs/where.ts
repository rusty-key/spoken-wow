/**
 * Which bucket holds an archive object (docs/platform/STORAGE.md). An object a team kept in its own
 * bucket has an `archive_object` row naming that bucket; every other object is in ours. A row is
 * never moved: a copy adds a row, so a read finds the object wherever a copy of it is.
 */
import "server-only";

import { ALL_TEAMS, query, queryIn } from "@/lib/db";
import { listenInServer } from "@/lib/teams/listen";

import { unseal } from "./seal";
import { archive, s3Blobs, type BlobPrefix, type BlobStore } from "./store";

export type Where = {
  store: BlobStore;
  /** The object's key in `store`: the archive key, or its quarantine key in ours. */
  key: string;
  /** The team bucket's id, null for ours. */
  backendId: string | null;
};

/** A PUT a team's bucket refused waits here in ours. Not a take's prefix, so the retry may delete it. */
export const QUARANTINE = "quarantine/";

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

function split(key: string): { prefix: BlobPrefix; sha256: string } {
  const slash = key.indexOf("/");
  return { prefix: key.slice(0, slash) as BlobPrefix, sha256: key.slice(slash + 1) };
}

/**
 * Where to read `key` (`<prefix>/<sha256>`). A copy not known to be missing first, one that has
 * landed before one waiting in quarantine, the newest first. When every team copy is missing,
 * ours: a move never purged it, so an object older than the move is still there.
 */
export async function locate(key: string): Promise<Where> {
  const { prefix, sha256 } = split(key);
  const rows = await query<{ backendId: string; pending: boolean; missing: boolean }>(
    `select "backendId", "pending", "missingAt" is not null as "missing" from "archive_object"
      where "prefix" = $1 and "sha256" = $2
      order by "missingAt" is not null, "pending", "keptAt" desc`,
    [prefix, sha256],
  );
  const found = rows.find((row) => !row.missing);
  if (!found) return { store: archive(), key, backendId: null };
  if (found.pending) return { store: archive(), key: `${QUARANTINE}${key}`, backendId: null };
  return { store: await backendStore(found.backendId), key, backendId: found.backendId };
}

/** Records that a team's bucket no longer holds the object, so the next read looks elsewhere. */
export async function markMissing(where: Where, key: string): Promise<void> {
  if (!where.backendId) return;
  const { prefix, sha256 } = split(key);
  await query(
    `update "archive_object" set "missingAt" = now()
      where "prefix" = $1 and "sha256" = $2 and "backendId" = $3 and "missingAt" is null`,
    [prefix, sha256, where.backendId],
  );
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
export async function blobBytes(key: string): Promise<Buffer | null> {
  const where = await locate(key);
  const object = await where.store.get(where.key);
  if (!object) {
    await markMissing(where, key);
    if (where.backendId) return blobBytes(key);
    return null;
  }
  return object.body ? Buffer.from(await new Response(object.body).arrayBuffer()) : null;
}

export function useBackendForTests(id: string, store: BlobStore): () => void {
  overrides.set(id, store);
  return () => {
    overrides.delete(id);
  };
}

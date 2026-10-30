/**
 * The audio archive in R2. Keys are `<prefix>/<sha256>` of the bytes, so a retried write costs
 * nothing and an object never changes once written.
 *
 * `SPOKEN_ARCHIVE_STORE`:
 *   disk  the volume only. The default, so a checkout with no R2 keys still works.
 *   dual  both. Reads stay on the volume until one-off/2026-10-archive-to-r2 has given every
 *         old row a blob.
 *   r2    the bucket only. Audio routes redirect to its public address.
 */
import "server-only";

import { createHash } from "node:crypto";

import { writeAtomic } from "@/lib/takes/bytes";

export type ArchiveMode = "disk" | "dual" | "r2";

export type BlobPrefix = "takes" | "recordings" | "encodings" | "samples" | "references";

export type BlobStore = {
  /** Store `data` under `key`. Writing the same key twice is harmless: the bytes are its name. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  /** Where a browser fetches the object. */
  url(key: string): string;
};

export function sha256Of(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function blobKey(prefix: BlobPrefix, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`not a sha256: ${sha256}`);
  return `${prefix}/${sha256}`;
}

export function r2Blobs(env: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
}): BlobStore {
  let client: import("aws4fetch").AwsClient | undefined;
  const signed = async (input: string, init?: RequestInit) => {
    if (!client) {
      const { AwsClient } = await import("aws4fetch");
      client = new AwsClient({
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
        service: "s3",
        region: "auto",
      });
    }
    return client.fetch(input, init);
  };
  const base = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}`;
  const at = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const fail = async (what: string, key: string, res: Response): Promise<never> => {
    throw new Error(`R2 ${what} ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  };
  const publicBase = env.publicUrl.endsWith("/") ? env.publicUrl : `${env.publicUrl}/`;

  return {
    async put(key, data, contentType) {
      const res = await signed(at(key), {
        method: "PUT",
        body: new Uint8Array(data),
        headers: {
          "content-type": contentType,
          // The key is the content's hash, so whatever is cached under it is never stale.
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
      if (!res.ok) await fail("PUT", key, res);
    },
    async get(key) {
      const res = await signed(at(key));
      if (res.status === 404) return null;
      if (!res.ok) await fail("GET", key, res);
      return Buffer.from(await res.arrayBuffer());
    },
    url: (key) => `${publicBase}${key}`,
  };
}

export function memoryBlobs(publicUrl = "https://archive.test/"): BlobStore & {
  objects: Map<string, { data: Buffer; contentType: string }>;
} {
  const objects = new Map<string, { data: Buffer; contentType: string }>();
  return {
    objects,
    async put(key, data, contentType) {
      objects.set(key, { data: Buffer.from(data), contentType });
    },
    async get(key) {
      return objects.get(key)?.data ?? null;
    },
    url: (key) => `${publicUrl}${key}`,
  };
}

let override: { store: BlobStore; mode: ArchiveMode } | null = null;
let fromEnv: BlobStore | null = null;

export function archiveMode(): ArchiveMode {
  if (override) return override.mode;
  const mode = process.env.SPOKEN_ARCHIVE_STORE ?? "disk";
  if (mode !== "disk" && mode !== "dual" && mode !== "r2") {
    throw new Error(`SPOKEN_ARCHIVE_STORE must be disk, dual or r2, not ${mode}`);
  }
  return mode;
}

export function writesBlobs(): boolean {
  return archiveMode() !== "disk";
}

export function readsBlobs(): boolean {
  return archiveMode() === "r2";
}

/** Nothing in `disk` mode should ask for this. */
export function archive(): BlobStore {
  if (override) return override.store;
  if (fromEnv) return fromEnv;
  const need = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "SPOKEN_ARCHIVE_BUCKET",
    "SPOKEN_ARCHIVE_URL",
  ] as const;
  const missing = need.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`SPOKEN_ARCHIVE_STORE=${archiveMode()} needs ${missing.join(", ")}`);
  }
  fromEnv = r2Blobs({
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: process.env.SPOKEN_ARCHIVE_BUCKET!,
    publicUrl: process.env.SPOKEN_ARCHIVE_URL!,
  });
  return fromEnv;
}

export type Kept = { sha256: string; inBucket: boolean; onDisk: boolean };

/** Both writes have finished when this returns, so the caller's row comes after them. */
export async function keep(prefix: BlobPrefix, data: Buffer, contentType: string, diskPath: string): Promise<Kept> {
  const sha256 = sha256Of(data);
  const inBucket = writesBlobs();
  const onDisk = !readsBlobs();
  await Promise.all([
    inBucket && archive().put(blobKey(prefix, sha256), data, contentType),
    onDisk && writeAtomic(diskPath, data),
  ]);
  return { sha256, inBucket, onDisk };
}

export type Stored =
  /** The file may be missing; the reader finds out. */
  | { kind: "file"; path: string }
  | { kind: "blob"; url: string }
  | { kind: "gone" };

export function blobOrFile(prefix: BlobPrefix, sha256: string | null, file: string | null): Stored {
  if (readsBlobs() && sha256) return { kind: "blob", url: archive().url(blobKey(prefix, sha256)) };
  return file ? { kind: "file", path: file } : { kind: "gone" };
}

export function useArchiveForTests(store: BlobStore, mode: ArchiveMode): () => void {
  override = { store, mode };
  return () => {
    override = null;
  };
}

/**
 * The audio archive as a bucket of blobs, each named by the SHA-256 of its bytes.
 *
 * The droplet's block volume was the only copy of every take, and it filled with each
 * language an author added. In R2 a gigabyte costs a cent and a half a month and nothing to
 * serve, so the bytes move there and the droplet keeps only the rows.
 *
 * `SPOKEN_ARCHIVE_STORE` says where audio goes while that move is under way:
 *
 *   disk  the volume, as before. The default, so a checkout with no R2 keys still works.
 *   dual  the volume and the bucket. Reads stay on the volume until the backfill has
 *         given every old row a blob (one-off/2026-10-archive-to-r2).
 *   r2    the bucket only. Audio routes redirect to its public address.
 *
 * Keys are `<prefix>/<sha256>`: the same bytes are one object however often they are put,
 * so a retried commit costs nothing and an object never changes once written.
 */
import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type ArchiveMode = "disk" | "dual" | "r2";

export type BlobPrefix = "takes" | "recordings" | "samples" | "references" | "previews" | "staging";

export type BlobStore = {
  /** Store `data` under `key`. Writing the same key twice is harmless: the bytes are its name. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** The object's bytes, or null when there is none. */
  get(key: string): Promise<Buffer | null>;
  /** The object's size, or null when there is none. */
  head(key: string): Promise<{ bytes: number } | null>;
  delete(key: string): Promise<void>;
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

/** The bucket through R2's S3 API, signed with aws4fetch. */
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
    async head(key) {
      const res = await signed(at(key), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) await fail("HEAD", key, res);
      return { bytes: Number(res.headers.get("content-length") ?? 0) };
    },
    async delete(key) {
      const res = await signed(at(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) await fail("DELETE", key, res);
    },
    url: (key) => `${publicBase}${key}`,
  };
}

/** A directory standing in for the bucket: development without R2 keys, and the tests. */
export function fsBlobs(root: string, publicUrl = "/blobs/"): BlobStore {
  const at = (key: string) => {
    const target = path.resolve(root, key);
    if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`unsafe key ${key}`);
    return target;
  };
  return {
    async put(key, data) {
      const target = at(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const partial = `${target}.part`;
      await fs.writeFile(partial, data);
      await fs.rename(partial, target);
    },
    async get(key) {
      return fs.readFile(at(key)).catch(() => null);
    },
    async head(key) {
      const info = await fs.stat(at(key)).catch(() => null);
      return info ? { bytes: info.size } : null;
    },
    async delete(key) {
      await fs.rm(at(key), { force: true });
    },
    url: (key) => `${publicUrl}${key}`,
  };
}

/** Objects in a Map, for tests that look at what was written. */
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
    async head(key) {
      const o = objects.get(key);
      return o ? { bytes: o.data.byteLength } : null;
    },
    async delete(key) {
      objects.delete(key);
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

/** Whether new audio goes to the bucket. */
export function writesBlobs(): boolean {
  return archiveMode() !== "disk";
}

/** Whether audio is read from the bucket rather than the volume. */
export function readsBlobs(): boolean {
  return archiveMode() === "r2";
}

/** The archive bucket. Throws in `disk` mode, where nothing should be asking for it. */
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

/** Point the archive at `store` in `mode` until the returned function is called. Tests only. */
export function useArchiveForTests(store: BlobStore, mode: ArchiveMode): () => void {
  override = { store, mode };
  return () => {
    override = null;
  };
}

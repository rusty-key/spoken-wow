/**
 * The audio archive in R2. Keys are `<prefix>/<sha256>` of the bytes, so a retried write costs
 * nothing and an object never changes once written.
 *
 * `SPOKEN_ARCHIVE_STORE`:
 *   disk  the volume only. The default, so a checkout with no R2 keys still works.
 *   dual  both. Reads stay on the volume until one-off/2026-10-archive-to-r2 has given every
 *         old row a blob.
 *   r2    the bucket only. Audio routes redirect public takes to its public address and
 *         answer the rest themselves.
 */
import "server-only";

import { createHash } from "node:crypto";

import { resolveRange, type Range, type RangeRequest } from "@/lib/range";
import { writeAtomic } from "@/lib/takes/bytes";

export type ArchiveMode = "disk" | "dual" | "r2";

export type BlobPrefix = "takes" | "recordings" | "encodings" | "samples" | "references";

/** Takes are anybody's to hear (docs/platform/PLAN.md decision 1); everything else is behind a grant. */
const SHARED: ReadonlySet<string> = new Set<BlobPrefix>(["takes", "encodings"]);

export type BlobRead = {
  /** The whole object's, whichever part of it `body` holds. */
  size: number;
  /** As it was put. */
  contentType: string;
  /** The part `body` holds: null for all of it. */
  range: Range | null;
  /** Null when the range asked for starts past the object's end. */
  body: ReadableStream<Uint8Array> | null;
};

export type BlobStore = {
  /** Store `data` under `key`. Writing the same key twice is harmless: the bytes are its name. */
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Null when there is no such object. */
  get(key: string, range?: RangeRequest): Promise<BlobRead | null>;
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
  const lengthOf = async (key: string, res: Response): Promise<number> => {
    const length = res.headers.get("content-length");
    return length === null ? fail("GET (no Content-Length)", key, res) : Number(length);
  };

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
    async get(key, wanted) {
      const range = wanted && ("suffix" in wanted ? `bytes=-${wanted.suffix}` : `bytes=${wanted.start}-${wanted.end ?? ""}`);
      const res = await signed(at(key), range ? { headers: { range } } : undefined);
      if (res.status === 404) return null;
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      if (res.status === 416) {
        await res.body?.cancel();
        // A 416 need not say how big the object is, and the answer to the client must.
        const head = await signed(at(key), { method: "HEAD" });
        if (!head.ok) await fail("HEAD", key, head);
        return { size: await lengthOf(key, head), contentType, range: null, body: null };
      }
      if (!res.ok) await fail("GET", key, res);
      if (res.status === 206) {
        const part = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("content-range") ?? "");
        if (!part) await fail("GET (bad Content-Range)", key, res);
        const [, start, end, size] = part!.map(Number);
        return { size, contentType, range: { start, end }, body: res.body };
      }
      return { size: await lengthOf(key, res), contentType, range: null, body: res.body };
    },
    url: (key) => `${publicBase}${key}`,
  };
}

/** `refusePut` answers every PUT as an R2 outage does. */
export function memoryBlobs({
  publicUrl = "https://archive.test/",
  refusePut = false,
}: { publicUrl?: string; refusePut?: boolean } = {}): BlobStore & {
  objects: Map<string, { data: Buffer; contentType: string }>;
} {
  const objects = new Map<string, { data: Buffer; contentType: string }>();
  return {
    objects,
    async put(key, data, contentType) {
      if (refusePut) throw new Error(`R2 PUT ${key}: HTTP 503`);
      objects.set(key, { data: Buffer.from(data), contentType });
    },
    async get(key, wanted) {
      const object = objects.get(key);
      if (!object) return null;
      const size = object.data.byteLength;
      const range = wanted ? resolveRange(wanted, size) : null;
      if (range === "unsatisfiable") return { size, contentType: object.contentType, range: null, body: null };
      const bytes = range ? object.data.subarray(range.start, range.end + 1) : object.data;
      return { size, contentType: object.contentType, range, body: new Blob([new Uint8Array(bytes)]).stream() };
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

/** The whole object, for a caller that needs its bytes rather than a response. */
export async function blobBytes(key: string): Promise<Buffer | null> {
  const object = await archive().get(key);
  return object?.body ? Buffer.from(await new Response(object.body).arrayBuffer()) : null;
}

/**
 * Both writes have finished when this returns, so the caller's row comes after them. The hash
 * comes back only once its object is in the bucket, and is what the row records: the backfill
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
): Promise<string | null> {
  const sha256 = sha256Of(data);
  const mode = archiveMode();
  const put = async () => {
    if (mode === "disk") return null;
    try {
      await archive().put(blobKey(prefix, sha256), data, contentType);
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

export type Stored =
  /** The file may be missing; the reader finds out. */
  | { kind: "file"; path: string; prefix: BlobPrefix }
  | { kind: "blob"; key: string }
  | { kind: "gone" };

export function blobOrFile(prefix: BlobPrefix, sha256: string | null, file: string | null): Stored {
  if (readsBlobs() && sha256) return { kind: "blob", key: blobKey(prefix, sha256) };
  return file ? { kind: "file", path: file, prefix } : { kind: "gone" };
}

/** Whether anybody may hear these bytes, and so whether the bucket's public address may be handed out. */
export function isShared(stored: Exclude<Stored, { kind: "gone" }>): boolean {
  return SHARED.has(stored.kind === "blob" ? stored.key.slice(0, stored.key.indexOf("/")) : stored.prefix);
}

export function useArchiveForTests(store: BlobStore, mode: ArchiveMode): () => void {
  override = { store, mode };
  return () => {
    override = null;
  };
}

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
import { setTimeout as sleep } from "node:timers/promises";

import type { Lang } from "@/lib/lang";
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
  /** The object's size, null when there is none. */
  head(key: string): Promise<{ size: number } | null>;
  /** Only ever for `probe/` and `quarantine/`: nothing deletes a take or a recording. */
  delete(key: string): Promise<void>;
  /** Where a browser fetches the object; null for a private bucket, which `presign` answers for. */
  url(key: string): string | null;
  /** An address that answers `method` for `expiresSec` seconds without credentials. */
  presign(key: string, options: { method: "GET" | "HEAD"; expiresSec: number }): Promise<string>;
};

export function sha256Of(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function blobKey(prefix: BlobPrefix, sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`not a sha256: ${sha256}`);
  return `${prefix}/${sha256}`;
}

/**
 * A take whose PUT fails has no hash, and its language cannot release. Sending again is safe: the
 * key is the bytes' hash and the PUT never overwrites. fetch rejects with a TypeError when no
 * response came back.
 */
async function sendWithRetries(send: () => Promise<Response>): Promise<Response> {
  for (const delay of [1000, 3000]) {
    try {
      const res = await send();
      if (res.status < 500) return res;
      await res.body?.cancel();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
    await sleep(delay);
  }
  return send();
}

type S3Config = {
  /** Scheme and host, no path: `https://<account>.r2.cloudflarestorage.com`, `https://s3.eu-west-1.amazonaws.com`. */
  endpoint: string;
  /** `auto` for R2 and GCS. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Ends in `/`. Null for a private bucket. */
  publicUrl: string | null;
  /** `endpoint/bucket/key` when true, `bucket.endpoint/key` when false. */
  pathStyle: boolean;
  /** False for a provider that ignores If-None-Match on a PUT: a HEAD comes first instead. */
  conditionalPut: boolean;
};

export class BodyLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyLimitError";
  }
}

/**
 * A bucket's body read whole, within `maxBytes` and `deadlineMs`: a team's bucket is not trusted to
 * send a small body, or to send it at all. Past either it is cancelled, and a BodyLimitError
 * thrown; with `truncate`, the first `maxBytes` are kept instead of the size failing.
 */
export async function readBounded(
  body: ReadableStream<Uint8Array>,
  { maxBytes, deadlineMs, truncate = false }: { maxBytes: number; deadlineMs: number; truncate?: boolean },
): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BodyLimitError(`no whole answer within ${deadlineMs / 1000}s`)), deadlineMs);
  });
  deadline.catch(() => {});
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) return Buffer.concat(chunks);
      if (size + value.byteLength > maxBytes) {
        if (!truncate) throw new BodyLimitError(`more than ${maxBytes} bytes`);
        chunks.push(value.subarray(0, maxBytes - size));
        await reader.cancel().catch(() => {});
        return Buffer.concat(chunks);
      }
      size += value.byteLength;
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** How long a bucket has to answer a request, its upload included. */
const ANSWER_MS = 120_000;

/** Any bucket that speaks S3's API with SigV4: R2, AWS S3, B2, Wasabi, GCS's interoperability keys, MinIO. */
export function s3Blobs(env: S3Config): BlobStore {
  let client: import("aws4fetch").AwsClient | undefined;
  const awsClient = async () => {
    if (!client) {
      const { AwsClient } = await import("aws4fetch");
      client = new AwsClient({
        accessKeyId: env.accessKeyId,
        secretAccessKey: env.secretAccessKey,
        service: "s3",
        region: env.region || "auto",
      });
    }
    return client;
  };
  const signed = async (input: string, init?: RequestInit) => {
    // Fetch the bytes themselves, not the signed Request: Next's fetch sends a Request's body
    // as a chunked stream, and R2 refuses a PUT without a Content-Length.
    const request = await (await awsClient()).sign(input, init);
    // ANSWER_MS bounds the answer, not the body: a reader bounds that (readBounded). A redirect
    // is never followed: it could reach a host the endpoint check never saw.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error(`${env.bucket} did not answer within ${ANSWER_MS / 1000}s`)), ANSWER_MS);
    try {
      return await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: init?.body,
        redirect: "manual",
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const endpoint = new URL(env.endpoint);
  const base = env.pathStyle
    ? `${endpoint.protocol}//${endpoint.host}/${env.bucket}`
    : `${endpoint.protocol}//${env.bucket}.${endpoint.host}`;
  const at = (key: string) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const fail = async (what: string, key: string, res: Response): Promise<never> => {
    // A taste of the bucket's error, never more: it may send a body without end.
    const said = res.body ? (await readBounded(res.body, { maxBytes: 1024, deadlineMs: 5_000, truncate: true }).catch(() => null)) : null;
    throw new Error(`${env.bucket} ${what} ${key}: HTTP ${res.status} ${said?.toString("utf8").slice(0, 200) ?? ""}`);
  };
  const publicBase = env.publicUrl && (env.publicUrl.endsWith("/") ? env.publicUrl : `${env.publicUrl}/`);
  const lengthOf = async (key: string, res: Response): Promise<number> => {
    const length = res.headers.get("content-length");
    return length === null ? fail("GET (no Content-Length)", key, res) : Number(length);
  };
  const head = async (key: string) => {
    const res = await signed(at(key), { method: "HEAD" });
    if (res.status === 404) return null;
    if (!res.ok) await fail("HEAD", key, res);
    return { size: await lengthOf(key, res) };
  };

  return {
    async put(key, data, contentType) {
      if (!env.conditionalPut && (await head(key))) return;
      const send = () => signed(at(key), {
        method: "PUT",
        body: new Uint8Array(data),
        headers: {
          "content-type": contentType,
          // The key is the content's hash, so whatever is cached under it is never stale.
          "cache-control": "public, max-age=31536000, immutable",
          // Never an overwrite: the bucket lock refuses one on takes/ and recordings/, and an
          // object already under this key holds these same bytes.
          "if-none-match": "*",
        },
      });
      const res = await sendWithRetries(send);
      if (res.status === 412) return void (await res.body?.cancel());
      // R2 checks a lock rule before the condition, so on a locked prefix an existing key
      // answers 409 rather than 412. A lock only ever holds an object that is already there.
      if (res.status === 409) {
        const answer = await res.text();
        if (answer.includes("<Code>ObjectLockedByBucketPolicy</Code>")) return;
        throw new Error(`${env.bucket} PUT ${key}: HTTP 409 ${answer.slice(0, 200)}`);
      }
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
        const found = await head(key);
        if (!found) return null;
        return { size: found.size, contentType, range: null, body: null };
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
    head,
    async delete(key) {
      const res = await signed(at(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) await fail("DELETE", key, res);
      else await res.body?.cancel();
    },
    url: (key) => (publicBase ? `${publicBase}${key}` : null),
    async presign(key, { method, expiresSec }) {
      const address = new URL(at(key));
      address.searchParams.set("X-Amz-Expires", String(expiresSec));
      const request = await (await awsClient()).sign(address.toString(), { method, aws: { signQuery: true } });
      return request.url;
    },
  };
}

/** Our archive bucket. */
export function r2Blobs(env: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
}): BlobStore {
  return s3Blobs({
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    bucket: env.bucket,
    accessKeyId: env.accessKeyId,
    secretAccessKey: env.secretAccessKey,
    publicUrl: env.publicUrl,
    pathStyle: true,
    conditionalPut: true,
  });
}

/** `refusePut` answers every PUT as an outage does. A null `publicUrl` is a private bucket. */
export function memoryBlobs({
  publicUrl = "https://archive.test/",
  refusePut = false,
}: { publicUrl?: string | null; refusePut?: boolean } = {}): BlobStore & {
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
    async head(key) {
      const object = objects.get(key);
      return object ? { size: object.data.byteLength } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
    url: (key) => (publicUrl === null ? null : `${publicUrl}${key}`),
    async presign(key, { method, expiresSec }) {
      return `https://signed.test/${key}?method=${method}&expires=${expiresSec}`;
    },
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
    "SPOKEN_ARCHIVE_ACCESS_KEY_ID",
    "SPOKEN_ARCHIVE_SECRET_ACCESS_KEY",
    "SPOKEN_ARCHIVE_BUCKET",
    "SPOKEN_ARCHIVE_URL",
  ] as const;
  const missing = need.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`SPOKEN_ARCHIVE_STORE=${archiveMode()} needs ${missing.join(", ")}`);
  }
  fromEnv = r2Blobs({
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.SPOKEN_ARCHIVE_ACCESS_KEY_ID!,
    secretAccessKey: process.env.SPOKEN_ARCHIVE_SECRET_ACCESS_KEY!,
    bucket: process.env.SPOKEN_ARCHIVE_BUCKET!,
    publicUrl: process.env.SPOKEN_ARCHIVE_URL!,
  });
  return fromEnv;
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
  /** `lang` is the language whose row names the object: a read prefers its team's own copy. */
  | { kind: "blob"; key: string; lang?: Lang }
  | { kind: "gone" };

export function blobOrFile(prefix: BlobPrefix, sha256: string | null, file: string | null, lang?: Lang): Stored {
  if (readsBlobs() && sha256) return { kind: "blob", key: blobKey(prefix, sha256), lang };
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

/**
 * Answering an <audio> element: whole files and byte ranges, off disk or out of the bucket.
 *
 * A seek abandons the previous response, so a file's stream is destroyed on cancel: otherwise
 * the read would run to completion against a client that stopped listening.
 */
import fs from "node:fs";
import { stat } from "node:fs/promises";

import { parseRange, type Range } from "@/lib/range";

export function streamOf(file: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  const node = fs.createReadStream(file, { start, end });
  return new ReadableStream({
    start(controller) {
      node.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      node.on("end", () => controller.close());
      node.on("error", (error) => controller.error(error));
    },
    cancel() {
      node.destroy();
    },
  });
}

export type RangedOptions = {
  etag: string;
  cacheControl: string;
  contentType: string;
  headers?: Record<string, string>;
  /** False for a URL whose bytes never change, where a conditional request is never sent. */
  revalidate?: boolean;
};

export function notModified(request: Request, etag: string, cacheControl: string): Response | null {
  if (request.headers.get("if-none-match") !== etag) return null;
  return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
}

/**
 * The answer to a request an <audio> element made for `size` bytes: a 304 when the tag still
 * matches, a 416 for a range past the end, and otherwise the whole of it or the range asked
 * for, which `read` is asked for only then.
 *
 * Range is not optional even for small files: Safari opens audio with `bytes=0-1` and refuses
 * a resource that answers 200, and without it the scrubber cannot seek.
 */
export async function serveRanged(
  request: Request,
  size: number,
  read: (range: Range | null) => BodyInit | Promise<BodyInit>,
  { etag, cacheControl, contentType, headers: extra = {}, revalidate = true }: RangedOptions,
): Promise<Response> {
  const fresh = revalidate ? notModified(request, etag, cacheControl) : null;
  if (fresh) return fresh;

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    ETag: etag,
    ...extra,
  };
  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(await read(null), { status: 200, headers });
  }
  headers["Content-Length"] = String(range.end - range.start + 1);
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(await read(range), { status: 206, headers });
}

/**
 * A file on disk, or null when it is not there. Without an `etag` it is tagged by its size and
 * mtime; mp3 unless `contentType` says otherwise.
 */
export async function serveFile(
  request: Request,
  file: string,
  { etag, contentType = "audio/mpeg", ...options }: Omit<RangedOptions, "etag" | "contentType"> & {
    etag?: string;
    contentType?: string;
  },
): Promise<Response | null> {
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  return serveRanged(request, info.size, (range) => (range ? streamOf(file, range.start, range.end) : streamOf(file)), {
    etag: etag ?? `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`,
    contentType,
    ...options,
  });
}

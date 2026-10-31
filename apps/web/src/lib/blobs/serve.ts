/**
 * Audio behind a grant, answered through the site: a redirect to the public, cached-for-good
 * bucket would keep working for anyone given the URL, after a revoke or a delete too. Ranges
 * are cut from the whole object, since these clips are small.
 */
import "server-only";

import { parseRange } from "@/lib/range";

import { archive } from "./store";

export async function serveBlob(
  request: Request,
  key: string,
  {
    cacheControl,
    contentType,
    headers: extra = {},
  }: {
    /** Must be `private`. */
    cacheControl: string;
    /** Read from the bytes when omitted: Ogg or mp3, the two kinds the archive holds. */
    contentType?: string;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  // The key ends in the bytes' hash, so it is the tag.
  const etag = `"${key.slice(key.lastIndexOf("/") + 1)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
  }

  const data = await archive().get(key);
  if (!data) return new Response("not in the archive", { status: 404 });

  const size = data.byteLength;
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": contentType ?? (data.subarray(0, 4).toString("latin1") === "OggS" ? "audio/ogg" : "audio/mpeg"),
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    ETag: etag,
    ...extra,
  };
  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(new Uint8Array(data), { status: 200, headers });
  }
  headers["Content-Length"] = String(range.end - range.start + 1);
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(new Uint8Array(data.subarray(range.start, range.end + 1)), { status: 206, headers });
}

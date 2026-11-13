/**
 * Audio behind a grant, answered through the site: a redirect to the public, cached-for-good
 * bucket would keep working for anyone given the URL, after a revoke or a delete too.
 */
import "server-only";

import { requestedRange, type Range } from "@/lib/range";
import { notModified, serveFile, serveRanged } from "@/lib/stream";

import { archive, type Stored } from "./store";

type PrivateOptions = {
  /** Without its scope, which is always `private`: max-age, immutable or no-cache. */
  cacheControl: string;
  /** The type the object was stored with when omitted. */
  contentType?: string;
  headers?: Record<string, string>;
};

const same = (a: Range | null, b: Range | null) => a?.start === b?.start && a?.end === b?.end;

export async function serveBlob(
  request: Request,
  key: string,
  { cacheControl, contentType, headers }: PrivateOptions,
): Promise<Response> {
  // The key ends in the bytes' hash, so it is the tag.
  const etag = `"${key.slice(key.lastIndexOf("/") + 1)}"`;
  const scoped = `private, ${cacheControl}`;
  const fresh = notModified(request, etag, scoped);
  if (fresh) return fresh;

  // Only the range asked for is fetched: Safari's bytes=0-1 probe and every seek would
  // otherwise download the whole object.
  const object = await archive().get(key, requestedRange(request.headers.get("range")) ?? undefined);
  if (!object) return new Response("not in the archive", { status: 404 });

  const response = await serveRanged(
    request,
    object.size,
    async (range) => {
      if (object.body && same(range, object.range)) return object.body;
      // The bucket read the header differently from parseRange; fetch exactly what is answered.
      await object.body?.cancel();
      const exact = await archive().get(key, range ? { start: range.start, end: range.end } : undefined);
      if (!exact?.body) throw new Error(`${key} vanished from the archive mid-request`);
      return exact.body;
    },
    { etag, cacheControl: scoped, contentType: contentType ?? object.contentType, headers, revalidate: false },
  );
  if (response.status === 416) await object.body?.cancel();
  return response;
}

/**
 * A grant's audio wherever it is kept. `etag` tags a file; a blob is tagged by its hash.
 * `missing` is the 404's text.
 */
export async function servePrivate(
  request: Request,
  stored: Stored,
  {
    etag,
    missing,
    revalidate,
    ...options
  }: PrivateOptions & { etag?: string; missing: string; revalidate?: boolean },
): Promise<Response> {
  if (stored.kind === "gone") return new Response(missing, { status: 404 });
  if (stored.kind === "blob") return serveBlob(request, stored.key, options);
  const served = await serveFile(request, stored.path, {
    ...options,
    cacheControl: `private, ${options.cacheControl}`,
    etag,
    revalidate,
  });
  return served ?? new Response(missing, { status: 404 });
}

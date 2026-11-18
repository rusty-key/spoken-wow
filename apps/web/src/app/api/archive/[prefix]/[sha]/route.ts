/**
 * Where a build or a pull fetches an archive object, whichever bucket keeps it
 * (docs/platform/STORAGE.md): a redirect to the bucket's public address, or a signed one for the
 * method asked, since a HEAD cannot use an address signed for a GET.
 *
 * Point SPOKEN_ARCHIVE_URL at `<site>/api/archive/` and every script that reads the archive by hash
 * finds team buckets too. Takes and their encodings are anybody's to hear. A voice actor's
 * recording also needs `Authorization: Bearer <SPOKEN_ARCHIVE_TOKEN>`, which fetch-blobs.mjs
 * sends, because a team's private bucket would otherwise hand it to anyone with its hash.
 */
import { timingSafeEqual } from "node:crypto";

import { blobKey, isShared, readsBlobs } from "@/lib/blobs/store";
import { addressOf, locate, SIGNED_FOR_SEC } from "@/lib/blobs/where";

export const dynamic = "force-dynamic";

const PREFIXES = new Set(["takes", "encodings", "recordings"]);

function trusted(request: Request): boolean {
  const token = process.env.SPOKEN_ARCHIVE_TOKEN;
  const sent = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !sent) return false;
  const [a, b] = [Buffer.from(token), Buffer.from(sent)];
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

async function answer(request: Request, params: Promise<{ prefix: string; sha: string }>, method: "GET" | "HEAD") {
  // Not a 404: a build reads that as a team's deletion and would leave every team-kept line out.
  if (!readsBlobs()) return new Response("this site's archive is not a bucket", { status: 503 });
  const { prefix, sha } = await params;
  if (!PREFIXES.has(prefix) || !/^[0-9a-f]{64}$/.test(sha)) return new Response("not an archive object", { status: 404 });
  const key = blobKey(prefix as "takes", sha);
  if (!isShared({ kind: "blob", key }) && !trusted(request)) return new Response("not allowed", { status: 403 });
  const { url, signed } = await addressOf(await locate(key), method);
  // A copy may move, but every copy holds these bytes: a cached redirect is never wrong for long.
  // A recording's is answered to a token alone, so no shared cache may keep it.
  const cache = !isShared({ kind: "blob", key })
    ? "private, no-store"
    : signed
      ? `private, max-age=${Math.min(300, SIGNED_FOR_SEC / 2)}`
      : "public, max-age=300";
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": cache } });
}

type Params = { params: Promise<{ prefix: string; sha: string }> };

export const GET = (request: Request, { params }: Params) => answer(request, params, "GET");
export const HEAD = (request: Request, { params }: Params) => answer(request, params, "HEAD");

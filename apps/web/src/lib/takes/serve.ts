/**
 * Answering a request for one take's audio: the live one of a line, or any earlier one.
 *
 * Written once for the four audio routes. They used to stat a store file each, with their
 * own Range and ETag code; now every take is a file in the archive found through its row
 * (store.ts), so what is left to differ between them is how a URL names the file and
 * whether the answer can be cached for good.
 *
 * The Range and ETag answer itself is serveFile's (lib/stream.ts), shared with the voice
 * clips.
 */
import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";

import { serveBlob } from "@/lib/blobs/serve";
import { serveFile } from "@/lib/stream";

import { BASE_LANG, langTag, type Lang } from "@/lib/lang";

import type { TakeBytes } from "./store";

/**
 * `immutable` for a URL naming one version, which never changes. A line's live URL names
 * whichever take is live, so it is revalidated: the ETag is the archived file's name, which
 * carries the version and a hash of the bytes, and moves exactly when the live take does.
 */
export async function serveTake(
  request: Request,
  bytes: TakeBytes,
  {
    immutable,
    lang = BASE_LANG,
    shared = true,
  }: {
    immutable: boolean;
    lang?: Lang;
    /** False for audio behind a grant, which no shared cache may keep: a voice actor's recordings. */
    shared?: boolean;
  },
): Promise<Response> {
  // Three different 404s, because the page predicts none of them and this is where a
  // listener finds out: nothing recorded, a take whose clip was not kept, and a take whose
  // named file is missing from this machine.
  if (bytes.kind === "none") return new Response("no audio for this line", { status: 404 });
  if (bytes.kind === "gone") return new Response("this take's audio was not kept", { status: 404 });

  const scope = shared ? "public" : "private";
  const cacheControl = immutable
    ? `${scope}, max-age=31536000, immutable`
    : `${scope}, max-age=300, must-revalidate`;

  // The bucket answers ranges itself, Safari's bytes=0-1 probe included. The redirect is
  // cached as the bytes were: a version's for good, a live line's for five minutes, after
  // which it may point at a newer take. Audio behind a grant is never redirected: the
  // bucket's URL would outlive the grant.
  if (bytes.kind === "blob" && !shared) {
    return serveBlob(request, bytes.key, {
      cacheControl,
      headers: lang === BASE_LANG ? {} : { "Content-Language": langTag(lang) },
    });
  }
  if (bytes.kind === "blob") {
    return new Response(null, {
      status: 302,
      headers: { Location: bytes.url, "Cache-Control": cacheControl },
    });
  }

  const info = await stat(bytes.path).catch(() => null);
  if (!info) return new Response("this take's audio is not on disk", { status: 404 });
  // The archived name is unique within one language's directory. Another language's take
  // of the same file can carry the same version and, in principle, the same short hash, so
  // its tag says which language it is; English keeps the tags browsers already hold.
  const archived = path.parse(bytes.path).name;
  const etag = lang === BASE_LANG ? `"${archived}"` : `"${lang}-${archived}"`;

  return serveFile(request, bytes.path, info.size, {
    etag,
    cacheControl,
    revalidate: !immutable,
    // Every take is mp3; a voice actor's recording may be kept as the Ogg it was uploaded as.
    contentType: path.extname(bytes.path) === ".ogg" ? "audio/ogg" : "audio/mpeg",
    headers: lang === BASE_LANG ? {} : { "Content-Language": langTag(lang) },
  });
}

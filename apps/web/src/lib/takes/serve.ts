/**
 * Answering a request for one take's audio: the live one of a line, or any earlier one.
 *
 * Written once for the four audio routes. They used to stat a store file each, with their
 * own Range and ETag code; now every take is a file in the archive found through its row
 * (store.ts), so what is left to differ between them is how a URL names the file and
 * whether the answer can be cached for good.
 *
 * Whether the answer may leave the site is the bytes' prefix's to say (lib/blobs/store.ts):
 * a take is redirected to the bucket, a voice actor's recording is streamed and cached
 * privately, since a bucket URL would outlive the grant.
 */
import "server-only";

import path from "node:path";

import { servePrivate } from "@/lib/blobs/serve";
import { isShared } from "@/lib/blobs/store";
import { addressOf, locate, SIGNED_FOR_SEC } from "@/lib/blobs/where";
import { serveFile } from "@/lib/stream";

import { BASE_LANG, langTag, type Lang } from "@/lib/lang";

import type { TakeBytes } from "./store";

/**
 * `immutable` for a URL naming one version, which never changes. A line's live URL names
 * whichever take is live, so it is revalidated: the ETag is the archived file's name, which
 * carries the version and a hash of the bytes, and moves exactly when the live take does.
 *
 * `perVisitor` for a live URL whose take depends on who asks (the acting team's, where a
 * language has several teams): private, so no shared cache hands one team's take to another
 * visitor, and revalidated on every use, so a site owner's switch is heard at once.
 */
export async function serveTake(
  request: Request,
  bytes: TakeBytes,
  { immutable, lang = BASE_LANG, perVisitor = false }: { immutable: boolean; lang?: Lang; perVisitor?: boolean },
): Promise<Response> {
  // Three different 404s, because the page predicts none of them and this is where a
  // listener finds out: nothing recorded, a take whose clip was not kept, and a take whose
  // named file is missing from this machine.
  if (bytes.kind === "none") return new Response("no audio for this line", { status: 404 });
  if (bytes.kind === "gone") return new Response("this take's audio was not kept", { status: 404 });
  const missing = "this take's audio is not on disk";

  const cacheControl = immutable
    ? "max-age=31536000, immutable"
    : perVisitor
      ? "no-cache"
      : "max-age=300, must-revalidate";
  const headers: Record<string, string> = lang === BASE_LANG ? {} : { "Content-Language": langTag(lang) };
  const file = bytes.kind === "file" ? fileOptions(bytes.path, lang, immutable) : {};

  if (!isShared(bytes)) return servePrivate(request, bytes, { cacheControl, headers, missing, ...file });

  // The bucket answers ranges itself, Safari's bytes=0-1 probe included. The redirect is
  // cached as the bytes were: a version's for good, a live line's for five minutes, after
  // which it may point at a newer take. A team's private bucket gets a signed address, so its
  // redirect is cached for less than the signature lasts.
  if (bytes.kind === "blob") {
    const where = await locate(bytes.key, bytes.lang ?? lang);
    const { url, signed } = await addressOf(where);
    // Only our own copy of a take stays where it is for good. One in a team's bucket can be moved,
    // re-addressed or deleted, and one in quarantine is deleted once it lands.
    // A quarantined copy is deleted once it lands, so its redirect is not kept at all.
    const lasting = where.backendId === null && !where.pending;
    const kept = lasting || perVisitor ? cacheControl : `max-age=${Math.min(300, SIGNED_FOR_SEC / 2)}`;
    const cached = where.pending ? "no-store" : `${signed || perVisitor ? "private" : "public"}, ${kept}`;
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": cached },
    });
  }
  const served = await serveFile(request, bytes.path, {
    cacheControl: `${perVisitor ? "private" : "public"}, ${cacheControl}`,
    headers,
    ...file,
  });
  return served ?? new Response(missing, { status: 404 });
}

function fileOptions(file: string, lang: Lang, immutable: boolean) {
  // The archived name is unique within one language's directory. Another language's take
  // of the same file can carry the same version and, in principle, the same short hash, so
  // its tag says which language it is; English keeps the tags browsers already hold.
  const archived = path.parse(file).name;
  return {
    etag: lang === BASE_LANG ? `"${archived}"` : `"${lang}-${archived}"`,
    // Every take is mp3; a voice actor's recording may be kept as the Ogg it was uploaded as.
    contentType: path.extname(file) === ".ogg" ? "audio/ogg" : "audio/mpeg",
    revalidate: !immutable,
  };
}

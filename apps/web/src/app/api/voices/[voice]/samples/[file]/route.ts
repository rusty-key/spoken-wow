/**
 * One uploaded clip: play it, or delete it.
 *
 * Range support is not optional even for clips a few megabytes long: Safari opens audio
 * with `Range: bytes=0-1` and refuses a resource that answers 200, so a naive whole-file
 * response works in Chrome and silently fails in Safari. Same reasoning, and the same
 * parseRange, as the take audio.
 */
import { recordActivity } from "@/lib/activity/store";
import { cloneName } from "@/lib/voices/clone-name";
import { langParam } from "@/lib/lang-server";
import fs from "node:fs";

import { parseRange } from "@/lib/range";
import { streamOf } from "@/lib/stream";
import { requireVoiceManager, requireVoiceViewer } from "@/lib/voices/authz";
import { contentTypeOf, deleteSample, isStoredSampleName, samplePath, sampleUrl } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string; file: string }> };

export async function GET(request: Request, context: Context) {
  const { voice, file } = await context.params;
  // Anybody who spends in the language may hear what its voices are cloned from.
  const { lang, denied } = await requireVoiceViewer(request, voice);
  if (denied) return denied;
  const clone = cloneName(voice, lang);
  if (!isStoredSampleName(file)) return new Response("bad clip name", { status: 400 });

  // The bucket answers ranges itself, and names objects by their bytes, so the redirect is
  // cached as the clip itself would be.
  const url = await sampleUrl(clone, file);
  if (url === null) return new Response("no such clip", { status: 404 });
  if (url) {
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, max-age=3600, immutable" },
    });
  }

  const target = await samplePath(clone, file);
  let size: number;
  let etag: string;
  try {
    const stat = fs.statSync(target);
    size = stat.size;
    etag = `W/"${size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  } catch {
    return new Response("no such clip", { status: 404 });
  }

  // A clip is immutable once written - the stored name is unique per upload, and an edit
  // means deleting and uploading again - so this can be cached hard. Private, because it is
  // only ever served to somebody signed in.
  const cacheControl = "private, max-age=3600, immutable";

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
  }

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": contentTypeOf(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    ETag: etag,
  };

  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(streamOf(target), { status: 200, headers });
  }

  headers["Content-Length"] = String(range.end - range.start + 1);
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(streamOf(target, range.start, range.end), { status: 206, headers });
}

export async function DELETE(request: Request, context: Context) {
  const { voice, file } = await context.params;
  const { session, denied } = await requireVoiceManager(voice);
  if (denied) return denied;
  // A slot is shared; its clips and its clone are the language\'s own (clone-name.ts).
  const { lang, denied: noLang } = await langParam(request);
  if (noLang) return noLang;
  const clone = cloneName(voice, lang);
  if (!isStoredSampleName(file)) return Response.json({ error: "bad clip name" }, { status: 400 });

  if (!(await deleteSample(clone, file))) {
    return Response.json({ error: "no such clip" }, { status: 404 });
  }
  // The file is gone for good, so this row is the only trace it was ever there.
  await recordActivity({
    kind: "sample.deleted",
    lang,
    actorId: session.user.id,
    subject: voice,
    detail: { files: [file] },
  });
  return Response.json({ voice, deleted: file });
}

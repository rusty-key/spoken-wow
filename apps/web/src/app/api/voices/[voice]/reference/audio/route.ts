/**
 * A reference's cut clip, to listen to beside its transcript.
 *
 * Answered by serveFile, which the take audio routes use too.
 */
import fs from "node:fs";

import { archive, blobKey, readsBlobs } from "@/lib/blobs/store";
import { serveFile } from "@/lib/stream";
import { requireVoiceViewer } from "@/lib/voices/authz";
import { readReference, referencePath } from "@/lib/voices/references";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function GET(request: Request, context: Context) {
  const { voice } = await context.params;
  // Anybody who spends in the language may hear what fish.audio is sent for this voice.
  const { lang, denied } = await requireVoiceViewer(request, voice);
  if (denied) return denied;

  const reference = await readReference(voice, lang);
  if (!reference) return new Response("no reference", { status: 404 });

  if (readsBlobs()) {
    if (!reference.sha256) return new Response("no reference clip", { status: 404 });
    return new Response(null, {
      status: 302,
      headers: { Location: archive().url(blobKey("references", reference.sha256)), "Cache-Control": "private, no-cache" },
    });
  }

  const target = referencePath(voice, lang);
  let size: number;
  try {
    size = fs.statSync(target).size;
  } catch {
    return new Response("no reference clip", { status: 404 });
  }

  // Not immutable: the same URL serves whatever the slot's reference is now, and the ETag is
  // the clipHash, which changes exactly when the clip or its transcript does.
  return serveFile(request, target, size, {
    etag: `"${reference.clipHash}"`,
    cacheControl: "private, no-cache",
  });
}

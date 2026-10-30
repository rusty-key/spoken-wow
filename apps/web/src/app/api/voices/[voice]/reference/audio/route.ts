/**
 * A reference's cut clip, to listen to beside its transcript.
 *
 * Answered by serveFile, which the take audio routes use too.
 */
import fs from "node:fs";

import { serveFile } from "@/lib/stream";
import { requireVoiceViewer } from "@/lib/voices/authz";
import { readReference, referenceClip } from "@/lib/voices/references";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function GET(request: Request, context: Context) {
  const { voice } = await context.params;
  // Anybody who spends in the language may hear what fish.audio is sent for this voice.
  const { lang, denied } = await requireVoiceViewer(request, voice);
  if (denied) return denied;

  const reference = await readReference(voice, lang);
  if (!reference) return new Response("no reference", { status: 404 });

  const clip = referenceClip(reference);
  if (clip.kind === "gone") return new Response("no reference clip", { status: 404 });
  if (clip.kind === "blob") {
    return new Response(null, { status: 302, headers: { Location: clip.url, "Cache-Control": "private, no-cache" } });
  }

  let size: number;
  try {
    size = fs.statSync(clip.path).size;
  } catch {
    return new Response("no reference clip", { status: 404 });
  }

  // Not immutable: the same URL serves whatever the slot's reference is now, and the ETag is
  // the clipHash, which changes exactly when the clip or its transcript does.
  return serveFile(request, clip.path, size, {
    etag: `"${reference.clipHash}"`,
    cacheControl: "private, no-cache",
  });
}

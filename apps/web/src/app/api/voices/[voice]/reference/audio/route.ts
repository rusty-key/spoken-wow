/** A reference's cut clip, to listen to beside its transcript. */
import { servePrivate } from "@/lib/blobs/serve";
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

  // Not immutable: the same URL serves whatever the slot's reference is now. A file's ETag is
  // the clipHash, which changes exactly when the clip or its transcript does.
  return servePrivate(request, referenceClip(reference), {
    cacheControl: "no-cache",
    contentType: "audio/mpeg",
    etag: `"${reference.clipHash}"`,
    missing: "no reference clip",
  });
}

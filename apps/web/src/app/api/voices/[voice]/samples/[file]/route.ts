/** One uploaded clip: play it, or delete it. */
import { recordActivity } from "@/lib/activity/store";
import { cloneName } from "@/lib/voices/clone-name";
import { langParam } from "@/lib/lang-server";

import { servePrivate } from "@/lib/blobs/serve";
import { requireVoiceManager, requireVoiceViewer } from "@/lib/voices/authz";
import { contentTypeOf, deleteSample, isStoredSampleName, sampleClip } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string; file: string }> };

export async function GET(request: Request, context: Context) {
  const { voice, file } = await context.params;
  // Anybody who spends in the language may hear what its voices are cloned from.
  const { lang, denied } = await requireVoiceViewer(request, voice);
  if (denied) return denied;
  const clone = cloneName(voice, lang);
  if (!isStoredSampleName(file)) return new Response("bad clip name", { status: 400 });

  // A clip is immutable once written - the stored name is unique per upload, and an edit
  // means deleting and uploading again - so this can be cached hard.
  return servePrivate(request, await sampleClip(clone, file), {
    cacheControl: "max-age=3600, immutable",
    contentType: contentTypeOf(file),
    missing: "no such clip",
  });
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

/** A design's preview or sample. Only bytes a version of the caller's team names are served. */
import { servePrivate } from "@/lib/blobs/serve";
import { requireDesignViewer } from "@/lib/voice-design/access";
import { designClip } from "@/lib/voice-design/audio";
import { isDesignAudio } from "@/lib/voice-design/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sha: string }> };

export async function GET(request: Request, context: Context) {
  const { sha } = await context.params;
  const { lang, denied } = await requireDesignViewer(request);
  if (denied) return denied;
  if (!/^[0-9a-f]{64}$/.test(sha) || !(await isDesignAudio(lang, sha))) return new Response("no such clip", { status: 404 });
  return servePrivate(request, designClip(sha, lang), {
    cacheControl: "max-age=31536000, immutable",
    contentType: "audio/mpeg",
    etag: `"${sha}"`,
    missing: "no such clip",
  });
}

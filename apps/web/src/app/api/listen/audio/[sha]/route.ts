/** A sample line of a version players hear on /listen. Nothing else of a design is served here. */
import { servePrivate } from "@/lib/blobs/serve";
import { langParam } from "@/lib/lang-server";
import { designClip } from "@/lib/voice-design/audio";
import { isPublicClip } from "@/lib/voice-feedback/public";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sha: string }> };

export async function GET(request: Request, context: Context) {
  const { sha } = await context.params;
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  if (!/^[0-9a-f]{64}$/.test(sha) || !(await isPublicClip(lang, sha))) return new Response("no such clip", { status: 404 });
  return servePrivate(request, designClip(sha, lang), {
    cacheControl: "max-age=3600",
    contentType: "audio/mpeg",
    etag: `"${sha}"`,
    missing: "no such clip",
  });
}

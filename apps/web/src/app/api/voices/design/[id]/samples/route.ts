/** Voice a version's sample lines, on the holder's own ElevenLabs key. */
import { failed, keyOrRefusal, requireDesigner } from "@/lib/voice-design/access";
import { sampleDesign } from "@/lib/voice-design/sample";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { lineIds?: unknown };
  const lineIds = Array.isArray(body.lineIds) && body.lineIds.every((v) => typeof v === "string") ? (body.lineIds as string[]) : null;

  const { key, denied: noKey } = await keyOrRefusal(session.user.id, "elevenlabs");
  if (noKey) return noKey;
  try {
    return Response.json({ design: await sampleDesign({ lang, id, lineIds, userId: session.user.id, apiKey: key }) });
  } catch (error) {
    return failed(error);
  }
}

/** Voice a version's sample lines, on the holder's own ElevenLabs key. */
import { requireApiKey } from "@/lib/generation/authz";
import { lineIndex } from "@/lib/quests/catalogue";
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { liveTakes } from "@/lib/voice-design/live";
import { sampleDesign } from "@/lib/voice-design/sample";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const { key, denied: noKey } = await requireApiKey(session.user.id, "elevenlabs");
  if (noKey) return noKey;
  try {
    const body = (await request.json().catch(() => ({}))) as { lines?: unknown };
    const lines = body.lines === "other" ? "other" : "same";
    const design = await sampleDesign({ lang, id, userId: session.user.id, apiKey: key, lines });
    // The page knew live takes only for lines sampled before it loaded.
    return Response.json({ design, live: liveTakes(lang, await lineIndex(lang), design.samples) });
  } catch (error) {
    return failed(error);
  }
}

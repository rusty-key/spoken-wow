/** Voice a version's sample lines, on the holder's own ElevenLabs key. */
import { bodyOf, objectOf } from "@/lib/api-body";
import { requireApiKey } from "@/lib/generation/authz";
import { SettingsError, validateDirection } from "@/lib/generation/settings";
import { lineIndex } from "@/lib/quests/catalogue";
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { liveTakes } from "@/lib/voice-design/live";
import { sampleDesign, type SampleLines } from "@/lib/voice-design/sample";

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
    const body = objectOf(await bodyOf(request));
    const lines: SampleLines = body?.lines === "other" ? "other" : "same";
    const typed = typeof body?.direction === "string" ? body.direction.trim() : "";
    const direction = typed ? validateDirection(typed, "direction") : undefined;
    const design = await sampleDesign({ lang, id, userId: session.user.id, apiKey: key, lines, direction });
    // The page knew live takes only for lines sampled before it loaded.
    return Response.json({ design, live: liveTakes(lang, await lineIndex(lang), design.samples) });
  } catch (error) {
    if (error instanceof SettingsError) return Response.json({ error: error.message }, { status: 400 });
    return failed(error);
  }
}

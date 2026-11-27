/** Remix a version's voice into the next version: Voice Remix, spent from the holder's ElevenLabs key. */
import { requireApiKey } from "@/lib/generation/authz";
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { remixVersion, retireOlder } from "@/lib/voice-design/design";
import { parseRemixSettings } from "@/lib/voice-design/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");

  const settings = parseRemixSettings(body.settings);
  if (typeof settings === "string") return Response.json({ error: settings }, { status: 400 });
  const { key, denied: noKey } = await requireApiKey(session.user.id, "elevenlabs");
  if (noKey) return noKey;
  try {
    const design = await remixVersion({
      lang,
      id,
      changes: text("changes"),
      prompt: text("prompt"),
      previewText: text("previewText"),
      settings,
      revisionHeard: text("revisionHeard") || null,
      archetype: text("archetype") || null,
      userId: session.user.id,
      apiKey: key,
    });
    const retired = await retireOlder({ lang, kept: design, userId: session.user.id, apiKey: key });
    return Response.json({ design, retired });
  } catch (error) {
    return failed(error);
  }
}

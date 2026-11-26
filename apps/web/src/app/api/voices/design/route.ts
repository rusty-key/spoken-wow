/** Design a new version of a slot: three Voice Design previews, spent from the caller's ElevenLabs key. */
import { failed, keyOrRefusal, requireDesigner } from "@/lib/voice-design/access";
import { designVersion } from "@/lib/voice-design/design";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "");

  const { key, denied: noKey } = await keyOrRefusal(session.user.id, "elevenlabs");
  if (noKey) return noKey;
  try {
    const design = await designVersion({
      lang,
      slot: text("slot"),
      prompt: text("prompt"),
      previewText: text("previewText"),
      analysisId: text("analysisId") || null,
      userId: session.user.id,
      apiKey: key,
    });
    return Response.json({ design });
  } catch (error) {
    return failed(error);
  }
}

/**
 * A version's voice in ElevenLabs: POST saves the chosen preview into the caller's account,
 * DELETE removes it from the holder's account to free a slot. The audio stays either way.
 */
import { requireApiKey } from "@/lib/generation/authz";
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { deleteDesignVoice, saveDesignVoice } from "@/lib/voice-design/design";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { preview?: unknown };
  if (typeof body.preview !== "number") return Response.json({ error: "say which preview" }, { status: 400 });

  const { key, denied: noKey } = await requireApiKey(session.user.id, "elevenlabs");
  if (noKey) return noKey;
  try {
    return Response.json({ design: await saveDesignVoice({ lang, id, preview: body.preview, userId: session.user.id, apiKey: key }) });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const { key, denied: noKey } = await requireApiKey(session.user.id, "elevenlabs");
  if (noKey) return noKey;
  try {
    return Response.json({ design: await deleteDesignVoice({ lang, id, userId: session.user.id, apiKey: key }) });
  } catch (error) {
    return failed(error);
  }
}

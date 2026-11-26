/** Draft the next version from a version's review, on the caller's Gemini key. Spends nothing at ElevenLabs. */
import { requireApiKey } from "@/lib/generation/authz";
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { reviseDesign } from "@/lib/voice-design/revise";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const { key, denied: noKey } = await requireApiKey(session.user.id, "gemini");
  if (noKey) return noKey;
  try {
    return Response.json({ revision: await reviseDesign({ lang, id, apiKey: key }) });
  } catch (error) {
    return failed(error);
  }
}

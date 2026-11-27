/** `{ position }`: how a sample line's take in this version differs from its live take, on the caller's Gemini key. */
import { bodyOf, objectOf } from "@/lib/api-body";
import { requireApiKey } from "@/lib/generation/authz";
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { differenceFromLive } from "@/lib/voice-design/difference";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const { key, denied: noKey } = await requireApiKey(session.user.id, "gemini");
  if (noKey) return noKey;
  const position = objectOf(await bodyOf(request))?.position;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
    return Response.json({ error: "position must be a sample line's position" }, { status: 400 });
  }
  try {
    return Response.json({ difference: await differenceFromLive({ lang, id, position, apiKey: key }) });
  } catch (error) {
    return failed(error);
  }
}

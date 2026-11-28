/**
 * `{ position, by }`: how a sample line's take in this version differs from its live take, as
 * Gemini hears it or Claude reads it, on the caller's own key for that one.
 */
import { bodyOf, objectOf } from "@/lib/api-body";
import { requireApiKey } from "@/lib/generation/authz";
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { differenceFromLive } from "@/lib/voice-design/difference";

export const dynamic = "force-dynamic";
// Claude at high effort reading a picture takes longer than Gemini listening.
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const body = objectOf(await bodyOf(request));
  const by = body?.by ?? "gemini";
  if (by !== "gemini" && by !== "claude") return Response.json({ error: "by is gemini or claude" }, { status: 400 });
  const position = body?.position;
  if (typeof position !== "number" || !Number.isInteger(position) || position < 0) {
    return Response.json({ error: "position must be a sample line's position" }, { status: 400 });
  }
  const { key, denied: noKey } = await requireApiKey(session.user.id, by === "claude" ? "anthropic" : "gemini");
  if (noKey) return noKey;
  try {
    return Response.json({ difference: await differenceFromLive({ lang, id, position, apiKey: key, by }) });
  } catch (error) {
    return failed(error);
  }
}

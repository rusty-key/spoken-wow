/** Analyse a race-gender: Gemini compares its flavors blind, on the caller's Gemini key. */
import { requireApiKey } from "@/lib/generation/authz";
import { failed, requireDesigner } from "@/lib/voice-design/access";
import { analyseGroup } from "@/lib/voice-design/analyse";

export const dynamic = "force-dynamic";
// Gemini listening to three clips can take a minute or two.
export const maxDuration = 300;

const GROUP = /^[a-z]+-[a-z]+$/;

export async function POST(request: Request) {
  const { session, lang, denied } = await requireDesigner(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { group?: unknown };
  const group = typeof body.group === "string" ? body.group : "";
  if (!GROUP.test(group)) return Response.json({ error: "group must be a race-gender, like orc-male" }, { status: 400 });

  const { key, denied: noKey } = await requireApiKey(session.user.id, "gemini");
  if (noKey) return noKey;
  try {
    return Response.json(await analyseGroup({ lang, group, userId: session.user.id, apiKey: key }));
  } catch (error) {
    return failed(error);
  }
}

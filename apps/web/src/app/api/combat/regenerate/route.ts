import { requireIn, requireSpeaker } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import { regenerateCombatLine } from "@/lib/combat/regenerate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;
  if (lang !== BASE_LANG) return Response.json({ error: "Combat Voice V1 is English only" }, { status: 400 });
  const body = await request.json().catch(() => null) as { lineId?: unknown } | null;
  if (typeof body?.lineId !== "string") return Response.json({ error: "lineId is required" }, { status: 400 });
  const { speaker, denied: noKey } = await requireSpeaker(session.user.id, BASE_LANG);
  if (noKey) return noKey;
  const result = await regenerateCombatLine(body.lineId, session.user.id, speaker);
  return result.ok ? Response.json(result) : Response.json({ error: result.failure.message }, { status: result.failure.status });
}

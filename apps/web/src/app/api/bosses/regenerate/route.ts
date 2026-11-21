/**
 * Regenerate one boss story, synchronously: /api/places/regenerate over the boss catalogue.
 *
 * The lineId travels in the body because it holds colons and may hold spaces
 * ('boss:36:edwin vancleef'). A batch goes through /api/regenerate/queue instead.
 */
import { requireIn, requireSpeaker } from "@/lib/generation/authz";
import { regenerateBossLine } from "@/lib/bosses/regenerate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  // After the role check, never instead of it: a key is a credential, not a permission.
  const { speaker, denied: noKey } = await requireSpeaker(session.user.id, lang);
  if (noKey) return noKey;

  const body = (await request.json().catch(() => ({}))) as { lineId?: unknown };
  if (typeof body.lineId !== "string" || !body.lineId) {
    return Response.json({ error: "lineId is required", kind: "bad-request" }, { status: 400 });
  }

  const result = await regenerateBossLine(body.lineId, session.user.id, { speaker, lang });

  if (!result.ok) {
    return Response.json(
      { error: result.failure.message, kind: result.failure.kind, fatal: result.failure.fatal },
      { status: result.failure.status },
    );
  }

  return Response.json(result);
}

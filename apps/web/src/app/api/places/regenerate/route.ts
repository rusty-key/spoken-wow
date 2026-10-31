/**
 * Regenerate one zone line, synchronously.
 *
 * One click, one request, one answer, matching the quests side. Anything larger goes
 * through the shared queue in /api/regenerate/queue; this stays direct because a single
 * line is cheap, is reversible through the archive, and deserves its result immediately
 * rather than after a round trip and a poll.
 *
 * The lineId travels in the body rather than the path for the reason the quests one does:
 * it contains colons ('s:1411:razor hill'), and round-tripping those through a dynamic
 * segment is encoding risk for no benefit.
 */
import { requireIn, requireSpeaker } from "@/lib/generation/authz";
import { regenerateZoneLine } from "@/lib/places/regenerate";
import { queuedForManager } from "@/lib/worker/local-line";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { lineId?: unknown };
  if (typeof body.lineId !== "string" || !body.lineId) {
    return Response.json({ error: "lineId is required", kind: "bad-request" }, { status: 400 });
  }

  const queued = await queuedForManager("places", body.lineId, session.user.id, lang);
  if (queued) return queued;
  // After the role check, never instead of it: a key is a credential, not a permission.
  const { speaker, denied: noKey } = await requireSpeaker(session.user.id, lang);
  if (noKey) return noKey;

  const result = await regenerateZoneLine(body.lineId, session.user.id, { speaker, lang });

  if (!result.ok) {
    return Response.json(
      { error: result.failure.message, kind: result.failure.kind, fatal: result.failure.fatal },
      { status: result.failure.status },
    );
  }

  return Response.json(result);
}

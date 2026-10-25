/**
 * Regenerate one book page, synchronously.
 *
 * One click, one request, one answer, matching both other sections. Anything larger goes
 * through the shared queue in /api/regenerate/queue; this stays direct because a single
 * page is cheap, is reversible through the archive, and deserves its result immediately
 * rather than after a round trip and a poll.
 *
 * The lineId travels in the body rather than the path because it contains a colon
 * ('b:1381'), and round-tripping that through a dynamic segment is encoding risk for no
 * benefit.
 *
 * Nothing is published afterwards. The pack's Data/Sounds.lua is built from the take table
 * when the pack is packaged, against a database synced from production, so the site has no
 * addon artifact to keep up to date.
 */
import { regenerateBookLine } from "@/lib/readables/regenerate";
import { requireIn, requireSpeaker } from "@/lib/generation/authz";
import { queuedForManager } from "@/lib/worker/local-line";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { lineId?: unknown };
  if (typeof body.lineId !== "string" || !body.lineId) {
    return Response.json({ error: "lineId is required", kind: "bad-request" }, { status: 400 });
  }

  const queued = await queuedForManager("readables", body.lineId, session.user.id, lang);
  if (queued) return queued;
  // After the role check, never instead of it: a key is a credential, not a permission.
  const { speaker, denied: noKey } = await requireSpeaker(session.user.id, lang);
  if (noKey) return noKey;

  const result = await regenerateBookLine(body.lineId, session.user.id, { speaker, lang });

  if (!result.ok) {
    return Response.json(
      { error: result.failure.message, kind: result.failure.kind, fatal: result.failure.fatal },
      { status: result.failure.status },
    );
  }

  return Response.json(result);
}

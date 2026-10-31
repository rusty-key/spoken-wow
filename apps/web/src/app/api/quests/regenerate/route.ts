/**
 * Regenerate one line, synchronously.
 *
 * One click, one request, one answer. Mass regeneration goes through the queue in
 * /api/regenerate/queue instead; this endpoint stays direct because a single line is cheap,
 * is reversible through history, and deserves its result immediately rather than after a
 * round trip and a poll.
 *
 * The concurrency budget in lib/generation/concurrency.ts reserves a slot for exactly this,
 * so a click still lands while a batch is running.
 *
 * The lineId travels in the body rather than the path. It contains colons (`q:5:accept`,
 * `g:{hash}:m`), and round-tripping those through a dynamic segment is encoding risk for no
 * benefit.
 */
import { requireIn, requireSpeaker } from "@/lib/generation/authz";
import { pinnedProvider } from "@/lib/generation/pinned";
import { regenerateLine } from "@/lib/generation/regenerate";
import { queuedForManager } from "@/lib/worker/local-line";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { lineId?: unknown };
  if (typeof body.lineId !== "string" || !body.lineId) {
    return Response.json({ error: "lineId is required", kind: "bad-request" }, { status: 400 });
  }

  // After the role check, never instead of it: a key is a credential, not a permission. After
  // the line is known, because a pinned voice decides whose key that is.
  const pinned = await pinnedProvider(body.lineId, lang);
  const queued = await queuedForManager("quests", body.lineId, session.user.id, lang, pinned);
  if (queued) return queued;
  const { speaker, denied: noKey } = await requireSpeaker(session.user.id, lang, pinned);
  if (noKey) return noKey;

  const result = await regenerateLine(body.lineId, session.user.id, { speaker, lang });

  if (!result.ok) {
    // `fatal` is the whole contract with the browser: it says whether to abandon the rest of
    // the batch or move to the next line. Running out of credits fails every remaining line
    // identically, and discovering that ninety more times is what this prevents.
    return Response.json(
      { error: result.failure.message, kind: result.failure.kind, fatal: result.failure.fatal },
      { status: result.failure.status },
    );
  }

  return Response.json(result);
}

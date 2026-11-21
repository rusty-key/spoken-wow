/**
 * Stop the queue.
 *
 * Pending jobs are cancelled; the handful already in flight are left to finish. Their
 * characters are at ElevenLabs and will be billed either way, so discarding the audio would
 * pay for nothing - which is also why this cannot promise the queue is empty the moment it
 * answers.
 *
 * It stops everything rather than one batch by default, because that is what a person
 * pressing Stop means: "stop, but keep spending on the other batch" is not a thing anyone
 * wants from that button. Everything is every language the caller regenerates in, though,
 * not the whole queue: a Portuguese translator's Stop halts the Portuguese work and leaves
 * the English queue running, as a global admin's halts all of it.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireAnyRegenerate } from "@/lib/generation/authz";
import { ensureQueueRunning } from "@/lib/generation/boot";
import { cancelPending } from "@/lib/generation/queue";
import { isAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { session, langs, denied } = await requireAnyRegenerate();
  if (denied) return denied;

  // cancelPending is plain SQL and does not itself need a worker, but a process whose only
  // queue traffic is Stop should still be contending for leadership - keeping the invariant
  // "every route that touches the queue wakes it" is easier than reasoning about exceptions
  // to it per route.
  ensureQueueRunning();

  const body = (await request.json().catch(() => ({}))) as { batchId?: unknown };
  const batchId = typeof body.batchId === "string" ? body.batchId : undefined;

  const cancelled = await cancelPending(`Stopped by ${session.user.name ?? "an admin"}`, {
    batchId,
    langs,
    by: session.user.id,
    everyTeam: isAdmin(session.user.role),
  });
  return NextResponse.json({ cancelled });
}

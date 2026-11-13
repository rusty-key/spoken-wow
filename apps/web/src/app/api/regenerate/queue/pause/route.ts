/**
 * Pause the queue.
 *
 * Nothing more is claimed in the caller's languages until someone resumes them. Unlike Stop,
 * the waiting work is kept: it stays pending, in its place, holding its files under the credit
 * guard. The jobs already in flight finish, for the reason Stop gives - their characters are
 * at the provider and billed either way.
 *
 * Scoped as Stop is: every language the caller regenerates in, so a Portuguese translator's
 * Pause holds the Portuguese work and leaves the English queue running.
 */
import { NextResponse } from "next/server";

import { requireAnyRegenerate } from "@/lib/generation/authz";
import { ensureQueueRunning } from "@/lib/generation/boot";
import { pauseQueue } from "@/lib/generation/queue";

export const dynamic = "force-dynamic";

export async function POST() {
  const { session, langs, denied } = await requireAnyRegenerate();
  if (denied) return denied;

  // Every route that touches the queue wakes it; see the Stop route for why.
  ensureQueueRunning();

  const paused = await pauseQueue(langs, session.user.id);
  return NextResponse.json({ paused });
}

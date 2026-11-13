/**
 * Resume a paused queue, in the languages the caller regenerates in.
 *
 * Nudges the worker so the held work starts at once rather than at the next idle tick.
 */
import { NextResponse } from "next/server";

import { requireAnyRegenerate } from "@/lib/generation/authz";
import { ensureQueueRunning, queueWorker } from "@/lib/generation/boot";
import { resumeQueue } from "@/lib/generation/queue";

export const dynamic = "force-dynamic";

export async function POST() {
  const { session, langs, denied } = await requireAnyRegenerate();
  if (denied) return denied;

  ensureQueueRunning();

  const resumed = await resumeQueue(langs, session.user.id);
  queueWorker()?.nudge();
  return NextResponse.json({ resumed });
}

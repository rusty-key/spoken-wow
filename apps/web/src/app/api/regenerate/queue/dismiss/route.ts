/**
 * Wave away the finished work the panel is still reporting.
 *
 * The X used to set React state, which meant a run stayed dismissed until the next reload and
 * then came back - with its credit total - on every navigation. Dismissal belongs on the
 * server for the same reason the panel does: it is a statement about the queue, not about one
 * tab's opinion of it.
 *
 * It never touches pending or running work. Stopping a queue is /stop's job: the same X asks
 * for it on a live queue, but only after a confirmation, and never through this route.
 *
 * Anybody who regenerates in any language may press it, since everybody watches the one
 * panel: it hides news, it never stops or undoes work, so there is nothing to scope.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireAnyRegenerate } from "@/lib/generation/authz";
import { dismissThrough } from "@/lib/generation/queue";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { session, langs, denied } = await requireAnyRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { through?: unknown };
  // The panel sends the cursor it was showing, so a job that finished between the render and
  // the click stays news rather than being dismissed unseen.
  const through = typeof body.through === "string" ? body.through : null;
  if (!through || !/^\d+$/.test(through)) {
    return NextResponse.json({ error: "through is required" }, { status: 400 });
  }

  // Written as the team of the caller's first language. Every team has a mark, and the one
  // panel is cut at the latest of them (dismissThrough).
  await dismissThrough(through, session.user.id, langs[0]);
  return NextResponse.json({ ok: true });
}

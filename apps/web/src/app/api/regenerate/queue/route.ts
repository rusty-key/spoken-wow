/**
 * The regeneration queue: adding to it, and watching it.
 *
 * One queue for both sections. GET is the whole of it rather than one batch, because there
 * is one plan and one budget behind it and a batch someone else started is spending the
 * same money.
 *
 * POST takes a source and, for quests, the *filters* rather than a list of jobs: the job
 * set is re-derived here with the same query /api/quests/search/lines runs, so queueing
 * forty thousand lines is a small request and the server decides what is in the batch -- a
 * client that sent the list could send a different one from the one it was quoted for.
 *
 * The places half sends line ids instead, and that is not an inconsistency worth removing.
 * Its whole corpus is ~1,400 lines, its filtering is a pure function over a catalogue held
 * in memory rather than a query, and its explorer already selects lines by hand -- so ids
 * ARE what the user picked, where on the quests side a filter is.
 */
import { NextRequest, NextResponse } from "next/server";

import { isSource } from "@/lib/sections";
import { requireAnyRegenerate, requireSpeaker, requireIn } from "@/lib/generation/authz";
import { planCatalogue, planQuestsByFilters, queuePlan, type Plan } from "@/lib/generation/batch-plan";
import { snapshot } from "@/lib/generation/queue";
import { ensureQueueRunning } from "@/lib/generation/boot";
import { isAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { session, lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;

  // Checked at enqueue rather than only in the worker. Every job in the batch is generated
  // with the key of whoever started it, so a batch queued without one is forty thousand rows
  // that can only fail - and the person who pressed the button is no longer here to be told.
  //
  // The provider is fixed here too: the estimate the batch was started on was for it, and
  // switching on /voices mid-batch must not move the jobs already waiting.
  const { provider, denied: noKey } = await requireSpeaker(session.user.id, lang);
  if (noKey) return noKey;

  // Nothing starts the queue on boot - see lib/generation/boot.ts for why - so every route
  // that touches it wakes it first. After the first call this is a property read.
  ensureQueueRunning();

  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    filters?: unknown;
    lineIds?: unknown;
    label?: unknown;
  };

  // Absent means quests, so a client that predates the second section keeps working.
  const source = body.source === undefined ? "quests" : body.source;
  if (!isSource(source)) {
    return NextResponse.json(
      { error: "source must be 'quests', 'places', 'readables' or 'bosses'", kind: "bad-request" },
      { status: 400 },
    );
  }

  const label = typeof body.label === "string" && body.label ? body.label : "a search";
  const userId = session.user.id;

  let plan: Plan;
  if (source === "quests") {
    if (typeof body.filters !== "string") {
      return NextResponse.json(
        { error: "filters is required, as a query string", kind: "bad-request" },
        { status: 400 },
      );
    }
    plan = await planQuestsByFilters(body.filters, lang, provider);
  } else {
    if (!Array.isArray(body.lineIds) || body.lineIds.some((id) => typeof id !== "string")) {
      return NextResponse.json(
        { error: "lineIds is required, as an array of strings", kind: "bad-request" },
        { status: 400 },
      );
    }
    plan = await planCatalogue(source, body.lineIds as string[], lang);
  }

  const result = await queuePlan({ plan, section: source, lang, userId, provider, label });
  if (result instanceof Response) return result;
  return NextResponse.json({ batchId: result.batchId, queued: result.queued, skipped: result.alreadyQueued });
}

export async function GET(request: NextRequest) {
  const { session, denied } = await requireAnyRegenerate();
  if (denied) return denied;

  // The poll is what resumes a batch after a deploy: Explorer calls this every fifteen
  // seconds for anyone who can regenerate, so an admin with the page open is the wake-up.
  ensureQueueRunning();

  const rawSince = request.nextUrl.searchParams.get("since");
  // snapshot() hands its cursor straight to `coalesce($1::bigint, 0)`, so anything that is
  // not digits belongs to the route, not the store: Postgres would otherwise throw and turn
  // a bad query param into an opaque 500 instead of a 400.
  if (rawSince !== null && !/^\d+$/.test(rawSince)) {
    return NextResponse.json(
      { error: "since must be a cursor from a previous snapshot", kind: "bad-request" },
      { status: 400 },
    );
  }

  // A global admin watches every line; anybody else sees only their own being said or
  // failing, while still seeing whose queues are ahead of theirs.
  return NextResponse.json(
    await snapshot(rawSince, {
      viewerId: session.user.id,
      linesOf: isAdmin(session.user.role) ? undefined : session.user.id,
    }),
  );
}

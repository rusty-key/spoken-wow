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

import { recordActivity } from "@/lib/activity/store";
import { broadcastStatuses } from "@/lib/broadcast/store";
import { corpus } from "@/lib/quests/catalogue";
import { isSource, type Source } from "@/lib/sections";
import {
  requireAnyRegenerate,
  requireQueueable,
  requireIn,
} from "@/lib/generation/authz";
import { queueBatch, snapshot } from "@/lib/generation/queue";
import { placesEntry, questsEntry, readablesEntry } from "@/lib/generation/queue-entries";
import { searchContext } from "@/lib/quests/context";
import { batchJobs, matchingLines } from "@/lib/search";
import { filtersFromParams, needsStale } from "@/lib/search-request";
import { recordingsFor } from "@/lib/recordings/store";
import { ensureQueueRunning, queueWorker } from "@/lib/generation/boot";
import { catalogue as bookCatalogue } from "@/lib/readables/catalogue";
import type { Lang } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import type { Provider } from "@/lib/generation/speakers/speaker";
import { pinnedVoices } from "@/lib/voices/references";
import { catalogue as zoneCatalogue } from "@/lib/places/catalogue";

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
  const { provider, denied: noKey } = await requireQueueable(session.user.id, lang);
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
      { error: "source must be 'quests', 'places' or 'readables'", kind: "bad-request" },
      { status: 400 },
    );
  }

  const label = typeof body.label === "string" && body.label ? body.label : "a search";

  if (source === "places") return queuePlaces(body.lineIds, label, session.user.id, lang, provider);
  if (source === "readables") return queueReadables(body.lineIds, label, session.user.id, lang, provider);

  if (typeof body.filters !== "string") {
    return NextResponse.json(
      { error: "filters is required, as a query string", kind: "bad-request" },
      { status: 400 },
    );
  }

  let filters = await filtersFromParams(new URLSearchParams(body.filters));
  const [catalogue, { voiced, context }, recordings, broadcast] = await Promise.all([
    corpus(lang),
    // Behind `regenerate`, which is working in the language, so the model and author
    // filters narrow the batch exactly as they narrowed the page it was quoted from.
    searchContext(needsStale(filters), false, lang, true),
    // And the recorded filter, as /api/quests/search/lines narrowed the quote: without the
    // recordings "not recorded" would queue every line and "recorded" none.
    filters.recorded ? recordingsFor("quests", lang) : undefined,
    // And the broadcast-id filter: without the statuses it matches nothing.
    filters.broadcast ? broadcastStatuses() : undefined,
  ]);
  if (!recordings) filters = { ...filters, recorded: undefined };
  const lines = matchingLines(catalogue, voiced, filters, { ...context, recordings, broadcast });
  // The same overrides the estimate was built from, so what is queued is what was quoted.
  const jobs = batchJobs(lines, context.overrides);

  if (jobs.length === 0) {
    return NextResponse.json({ error: "nothing to regenerate", kind: "bad-request" }, { status: 400 });
  }

  // A pinned voice's lines are fish.audio jobs in whatever batch they fall in, so a batch that
  // holds one needs the fish.audio key as well, for the reason the first key is checked above.
  const pinned = provider === "fish" ? new Set<string>() : await pinnedVoices(lang);
  if (jobs.some((job) => pinned.has(job.voice))) {
    const { denied: noFishKey } = await requireQueueable(session.user.id, lang, "fish");
    if (noFishKey) return noFishKey;
  }

  const { batchId, queued, skipped } = await queueBatch(
    label,
    session.user.id,
    "quests",
    lang,
    jobs.map((job) => ({ ...questsEntry(job), provider: pinned.has(job.voice) ? "fish" : undefined })),
    provider,
  );
  await recordQueued(batchId, label, session.user.id, "quests", lang, queued);

  // The loop is on a two-second idle tick, and waiting that out before the first take would
  // be the most visible part of pressing the button.
  queueWorker()?.nudge();

  return NextResponse.json({ batchId, queued, skipped });
}

/**
 * A places batch, from the ids the explorer selected.
 *
 * The entries are looked up in the catalogue rather than trusted from the body, which is
 * the same protection the quests half gets by re-deriving from filters: what is queued is
 * what exists, and an id nobody recognises is dropped rather than becoming a job that can
 * only fail. A line with no text is dropped too -- an untranslated line has nothing to
 * narrate, and paying to find that out once per line is what the quote exists to prevent.
 */
async function queuePlaces(
  lineIds: unknown,
  label: string,
  userId: string,
  lang: Lang,
  provider: Provider,
): Promise<NextResponse> {
  if (!Array.isArray(lineIds) || lineIds.some((id) => typeof id !== "string")) {
    return NextResponse.json(
      { error: "lineIds is required, as an array of strings", kind: "bad-request" },
      { status: 400 },
    );
  }

  const wanted = new Set(lineIds as string[]);
  const jobs = (await zoneCatalogue(lang))
    .filter((entry) => wanted.has(entry.id))
    .map(placesEntry)
    .filter((job) => job !== null);

  if (jobs.length === 0) {
    return NextResponse.json(
      { error: "nothing to regenerate", kind: "bad-request" },
      { status: 400 },
    );
  }

  const { batchId, queued, skipped } = await queueBatch(label, userId, "places", lang, jobs, provider);
  await recordQueued(batchId, label, userId, "places", lang, queued);

  queueWorker()?.nudge();

  return NextResponse.json({ batchId, queued, skipped });
}

/**
 * A readables batch, from the ids the explorer selected.
 *
 * The pages are looked up in the corpus rather than trusted from the body, exactly as the
 * places half does: what is queued is what exists, and an id nobody recognises is dropped
 * rather than becoming a job that can only fail. The 88 unvoiceable pages are dropped for
 * the same reason -- they are in the corpus because the game has them, not because anyone
 * can narrate them.
 */
async function queueReadables(
  lineIds: unknown,
  label: string,
  userId: string,
  lang: Lang,
  provider: Provider,
): Promise<NextResponse> {
  if (!Array.isArray(lineIds) || lineIds.some((id) => typeof id !== "string")) {
    return NextResponse.json(
      { error: "lineIds is required, as an array of strings", kind: "bad-request" },
      { status: 400 },
    );
  }

  const wanted = new Set(lineIds as string[]);
  const jobs = (await bookCatalogue(lang))
    .filter((page) => wanted.has(page.id))
    .map(readablesEntry)
    .filter((job) => job !== null);

  if (jobs.length === 0) {
    return NextResponse.json(
      { error: "nothing to regenerate", kind: "bad-request" },
      { status: 400 },
    );
  }

  const { batchId, queued, skipped } = await queueBatch(label, userId, "readables", lang, jobs, provider);
  await recordQueued(batchId, label, userId, "readables", lang, queued);

  queueWorker()?.nudge();

  return NextResponse.json({ batchId, queued, skipped });
}

/**
 * One row for the whole batch, however many lines it holds. The takes it cuts are recorded
 * as they land and folded under this row on the activity page. None when every line was
 * already queued, since no batch was kept.
 */
async function recordQueued(
  batchId: string | null,
  label: string,
  actorId: string,
  source: Source,
  lang: Lang,
  count: number,
): Promise<void> {
  if (!batchId) return;
  await recordActivity({
    kind: "batch.queued",
    lang,
    source,
    subject: batchId,
    actorId,
    detail: { batchId, label, count },
  });
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

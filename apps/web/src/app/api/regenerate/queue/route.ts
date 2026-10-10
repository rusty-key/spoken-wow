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
 * The zones half sends line ids instead, and that is not an inconsistency worth removing.
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
  requireSpeaker,
  requireIn,
} from "@/lib/generation/authz";
import { createBatch, enqueue, snapshot } from "@/lib/generation/queue";
import { searchContext } from "@/lib/quests/context";
import { batchJobs, matchingLines } from "@/lib/search";
import { filtersFromParams, needsStale } from "@/lib/search-request";
import { recordingsFor } from "@/lib/recordings/store";
import { ensureQueueRunning, queueWorker } from "@/lib/generation/boot";
import { catalogue as bookCatalogue } from "@/lib/books/catalogue";
import type { Lang } from "@/lib/lang";
import { isAdmin } from "@/lib/permissions";
import type { Provider } from "@/lib/generation/speakers/speaker";
import { catalogue as zoneCatalogue } from "@/lib/zones/catalogue";

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
      { error: "source must be 'quests', 'zones' or 'books'", kind: "bad-request" },
      { status: 400 },
    );
  }

  const label = typeof body.label === "string" && body.label ? body.label : "a search";

  if (source === "zones") return queueZones(body.lineIds, label, session.user.id, lang, provider);
  if (source === "books") return queueBooks(body.lineIds, label, session.user.id, lang, provider);

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

  const batchId = await createBatch(label, session.user.id, "quests", lang);
  // BatchLine calls it audioPath and the queue calls it file, because a job is one mp3 on
  // either side and only the quests corpus thinks of it as a line's audio.
  const { queued, skipped } = await enqueue(
    batchId,
    jobs.map((job) => ({
      lineId: job.lineId,
      file: job.audioPath,
      npcName: job.npcName,
      preview: job.preview,
      characters: job.characters,
    })),
    "quests",
    lang,
    provider,
  );
  await recordQueued(batchId, label, session.user.id, "quests", lang, queued);

  // The loop is on a two-second idle tick, and waiting that out before the first take would
  // be the most visible part of pressing the button.
  queueWorker()?.nudge();

  return NextResponse.json({ batchId, queued, skipped });
}

/**
 * A zones batch, from the ids the explorer selected.
 *
 * The entries are looked up in the catalogue rather than trusted from the body, which is
 * the same protection the quests half gets by re-deriving from filters: what is queued is
 * what exists, and an id nobody recognises is dropped rather than becoming a job that can
 * only fail. A line with no text is dropped too -- an untranslated line has nothing to
 * narrate, and paying to find that out once per line is what the quote exists to prevent.
 */
async function queueZones(
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
    .filter((entry) => wanted.has(entry.id) && entry.spoken.trim() !== "")
    .map((entry) => ({
      lineId: entry.id,
      file: entry.file,
      // There is no NPC here. The column is a label for the progress readout, and the
      // zone is what names a line on screen.
      npcName: entry.zoneName,
      preview: entry.short || entry.full.slice(0, 120),
      characters: entry.spoken.length,
    }));

  if (jobs.length === 0) {
    return NextResponse.json(
      { error: "nothing to regenerate", kind: "bad-request" },
      { status: 400 },
    );
  }

  const batchId = await createBatch(label, userId, "zones", lang);
  const { queued, skipped } = await enqueue(batchId, jobs, "zones", lang, provider);
  await recordQueued(batchId, label, userId, "zones", lang, queued);

  queueWorker()?.nudge();

  return NextResponse.json({ batchId, queued, skipped });
}

/**
 * A books batch, from the ids the explorer selected.
 *
 * The pages are looked up in the corpus rather than trusted from the body, exactly as the
 * zones half does: what is queued is what exists, and an id nobody recognises is dropped
 * rather than becoming a job that can only fail. The 88 unvoiceable pages are dropped for
 * the same reason -- they are in the corpus because the game has them, not because anyone
 * can narrate them.
 */
async function queueBooks(
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
    .filter((page) => wanted.has(page.id) && page.generatable && page.spoken.trim() !== "")
    .map((page) => ({
      lineId: page.id,
      file: page.file,
      // There is no NPC here either. The column is a label for the progress readout, and
      // a book's title plus its page number is what names a page on screen.
      npcName: page.pageCount > 1 ? `${page.title} (${page.pageNumber}/${page.pageCount})` : page.title,
      preview: page.spoken.slice(0, 120),
      characters: page.spoken.length,
    }));

  if (jobs.length === 0) {
    return NextResponse.json(
      { error: "nothing to regenerate", kind: "bad-request" },
      { status: 400 },
    );
  }

  const batchId = await createBatch(label, userId, "books", lang);
  const { queued, skipped } = await enqueue(batchId, jobs, "books", lang, provider);
  await recordQueued(batchId, label, userId, "books", lang, queued);

  queueWorker()?.nudge();

  return NextResponse.json({ batchId, queued, skipped });
}

/**
 * One row for the whole batch, however many lines it holds. The takes it cuts are recorded
 * as they land and folded under this row on the activity page.
 */
async function recordQueued(
  batchId: string,
  label: string,
  actorId: string,
  source: Source,
  lang: Lang,
  count: number,
): Promise<void> {
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

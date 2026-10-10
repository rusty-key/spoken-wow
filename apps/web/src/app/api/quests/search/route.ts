import { NextRequest, NextResponse } from "next/server";

import { BROADCAST_STATUSES } from "@/lib/broadcast/status";
import {
  broadcastIdsFor,
  broadcastStatuses,
  mergedInto,
  momentSiblingsFor,
  type LineBroadcast,
} from "@/lib/broadcast/store";
import { langParam, worksHere } from "@/lib/lang-server";
import { corpus, isCorpusEmpty } from "@/lib/quests/catalogue";
import { searchContext } from "@/lib/quests/context";
import { dirtyQuestFiles } from "@/lib/quests/dirtiness";
import { staleFiles } from "@/lib/quests/staleness";
import { recordingsFor } from "@/lib/recordings/store";
import { filtersFromParams, needsDirty, needsStale, withoutMadeBy } from "@/lib/search-request";
import { PAGE_SIZE, search } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * One page of quests lines, each carrying everything its row shows.
 *
 * Every row says whether its audio is stale and whether it is dirty, the way the zones and
 * books rows always have. Quests used to leave both out and have the explorer ask a second
 * route for them per page, holding the answers in state beside the rows -- a second source
 * for the same facts, which the explorer then had to reconcile after every regeneration.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  const limit = Number(params.get("limit")) || PAGE_SIZE;
  // The page number is what the URL carries, so a link stays meaningful if the page size
  // ever changes; the offset is arithmetic and belongs on this side of it.
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));

  // Only the context depends on the filters, so the corpus is fetched alongside them.
  let filters, lines, seesMadeBy, recordings, broadcastStatus;
  try {
    [filters, lines, seesMadeBy, recordings, broadcastStatus] = await Promise.all([
      filtersFromParams(params),
      corpus(lang),
      worksHere(lang),
      recordingsFor("quests", lang),
      // The value filtersFromParams keeps, not just any `bt`: an invalid one filters nothing.
      (BROADCAST_STATUSES as readonly string[]).includes(params.get("bt") ?? "")
        ? broadcastStatuses()
        : undefined,
    ]);
  } catch (error) {
    // The zones and books searches answer an empty table the same way: a page can say "no
    // lines yet" where an unexplained 500 says nothing.
    if (!isCorpusEmpty(error)) throw error;
    return NextResponse.json({ error: (error as Error).message, code: "corpus_empty" }, { status: 503 });
  }
  if (!seesMadeBy) filters = withoutMadeBy(filters);
  // A link to a gossip line merged into another (lib/broadcast/relink.ts) shows the line it went into.
  if (filters.line?.startsWith("g:")) filters = { ...filters, line: (await mergedInto(filters.line)) ?? filters.line };
  if (!recordings) filters = { ...filters, recorded: undefined };
  const { voiced, context: base } = await searchContext(
    needsStale(filters),
    needsDirty(filters),
    lang,
    seesMadeBy,
  );
  const context = { ...base, recordings, broadcast: broadcastStatus };

  // "Clear all" needs every dirty file the filter matches, not a page of rows. The same
  // shape the zones search route answers for its own explorer.
  if (params.get("ids") === "1") {
    const all = search(lines, voiced, { ...filters, offset: 0, limit: Number.MAX_SAFE_INTEGER }, context);
    // The whole dirty set, intersected here, rather than the match set sent to Postgres as a
    // parameter: unfiltered, that is eleven thousand paths in an `= any($1)`, and several
    // times slower than asking for every dirty file.
    const dirty = context.dirty ?? (await dirtyQuestFiles(undefined, lang));
    const files = new Set(all.lines.map((line) => line.audioPath));
    return NextResponse.json({ dirtyFiles: [...dirty].filter((file) => files.has(file)) });
  }

  const result = search(lines, voiced, { ...filters, offset: (page - 1) * limit, limit }, context);

  // For the page only, when no filter already computed the whole set: the two questions
  // cost a query each over the files asked about, and fifty is what a page holds.
  const files = [...new Set(result.lines.map((line) => line.audioPath))];
  const gossip = [...new Set(result.lines.filter((line) => line.source === "gossip").map((line) => line.lineId))];
  const [stale, dirty, broadcast, siblings] = await Promise.all([
    context.stale ?? staleFiles(files, lang),
    context.dirty ?? dirtyQuestFiles(files, lang),
    gossip.length > 0 ? broadcastIdsFor(gossip) : new Map<string, LineBroadcast[]>(),
    gossip.length > 0 ? momentSiblingsFor(gossip) : new Map<string, string[]>(),
  ]);
  for (const line of result.lines) {
    line.stale = stale.has(line.audioPath);
    line.dirty = dirty.has(line.audioPath);
    if (line.source === "gossip") {
      line.broadcast = broadcast.get(line.lineId) ?? [];
      line.moment = siblings.get(line.lineId) ?? [];
    }
  }

  return NextResponse.json(result);
}

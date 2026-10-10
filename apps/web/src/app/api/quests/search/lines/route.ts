/**
 * Every line a set of filters matches, as batch jobs.
 *
 * Separate from /api/search because the two answer different questions: that one answers
 * "what is on this page", this one answers "what would regenerating all of this do". Paging
 * the second would be meaningless - a cost estimate for 50 of 3,000 lines is worse than no
 * estimate at all.
 */
import { NextRequest, NextResponse } from "next/server";

import { langParam, worksHere } from "@/lib/lang-server";
import { corpus } from "@/lib/quests/catalogue";
import { searchContext } from "@/lib/quests/context";
import { broadcastStatuses } from "@/lib/broadcast/store";
import { recordingsFor } from "@/lib/recordings/store";
import { filtersFromParams, needsStale, withoutMadeBy } from "@/lib/search-request";
import { batchJobs, matchingLines } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  // Gated like the search itself, or narrowing by author here would say whose lines are whose.
  const seesMadeBy = await worksHere(lang);
  let filters = await filtersFromParams(request.nextUrl.searchParams);
  if (!seesMadeBy) filters = withoutMadeBy(filters);
  const [catalogue, { voiced, context }, recordings, broadcast] = await Promise.all([
    corpus(lang),
    searchContext(needsStale(filters), false, lang, seesMadeBy),
    // So "regenerate everything not yet recorded" means what the page showed. Only asked
    // when filtering on it; recordingsFor is undefined for anybody who may not see them, and
    // the filter then matches on nothing -- recordedMatches without the recordings.
    filters.recorded ? recordingsFor("quests", lang) : undefined,
    filters.broadcast ? broadcastStatuses() : undefined,
  ]);
  if (!recordings) filters = { ...filters, recorded: undefined };
  const lines = matchingLines(catalogue, voiced, filters, { ...context, recordings, broadcast });
  // The same overrides the estimate is built from, so the quote prices the text that will
  // actually be sent rather than the text the corpus happens to hold.
  return NextResponse.json({ jobs: batchJobs(lines, context.overrides) });
}

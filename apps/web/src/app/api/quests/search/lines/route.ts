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
import { publicSearchContext, searchContext } from "@/lib/quests/context";
import { broadcastStatuses } from "@/lib/broadcast/store";
import { recordingsFor } from "@/lib/recordings/store";
import { filtersFromParams, needsDirty, needsLevels, needsStale, needsZones, withoutMadeBy } from "@/lib/search-request";
import { batchPlan, matchingLines } from "@/lib/search";
import { asTeam } from "@/lib/teams/acting";
import { viewedOther, viewOnly } from "@/lib/teams/viewing";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { lang, denied } = await langParam(request);
  if (denied) return denied;
  // Another team's lines are matched as its search page shows them, from its corpus and live
  // takes alone, so the count here agrees with that page and none of its private rows are read.
  const other = await viewedOther(request.nextUrl.searchParams, lang);
  if (other instanceof Response) return other;
  // Gated like the search itself, or narrowing by author here would say whose lines are whose.
  const seesMadeBy = other ? false : await worksHere(lang);
  // Another team's roster names its voices, so its filters are read as it.
  const read = () => filtersFromParams(request.nextUrl.searchParams, lang);
  let filters = await (other ? asTeam(lang, other, read) : read());
  if (!seesMadeBy) filters = withoutMadeBy(filters);
  if (other) filters = viewOnly(filters);
  const [catalogue, { voiced, context }, recordings, broadcast] = await Promise.all([
    other ? asTeam(lang, other, () => corpus(lang)) : corpus(lang),
    other
      ? publicSearchContext(lang, other, needsLevels(filters), needsZones(filters))
      : searchContext(needsStale(filters), needsDirty(filters), lang, seesMadeBy, needsLevels(filters), undefined, needsZones(filters)),
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
  // `matched` and `skipped` account for the gap between the button's count and the jobs.
  const { jobs, skipped } = batchPlan(lines, context.overrides);
  return NextResponse.json({ jobs, matched: lines.length, skipped });
}

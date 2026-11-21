/**
 * What one group row lists when it is opened on the activity page: the takes a queue batch
 * cut, the marks one click cleared (`kind=marks`), or the batches one Stop stopped
 * (`kind=stops`).
 *
 * Fetched on demand rather than sent with the page: the page folds a group into one row
 * precisely because it can be hundreds of rows, and most groups are never opened.
 *
 * Takes the page's day range, so that an opened row lists what its count counted.
 *
 * Behind the same capability as the page, in the group's language.
 */
import { NextRequest } from "next/server";

import { FOLDS, isGroup } from "@/lib/activity/kinds";
import { groupRows, isDay } from "@/lib/activity/store";
import { requireIn } from "@/lib/generation/authz";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { lang, denied } = await requireIn(request, "admin");
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const id = params.get("id");
  if (!id || !isUuid(id)) {
    return Response.json({ error: "id must be a group id" }, { status: 400 });
  }
  const kind = params.get("kind") ?? "batch";
  if (!isGroup(kind)) {
    return Response.json({ error: `kind must be one of ${Object.keys(FOLDS).join(", ")}` }, { status: 400 });
  }
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  if ((from !== undefined && !isDay(from)) || (to !== undefined && !isDay(to)) || (from && to && from > to)) {
    return Response.json({ error: "from and to must be days, from no later than to" }, { status: 400 });
  }

  return Response.json({ takes: await groupRows(lang, kind, id, { from, to }) });
}

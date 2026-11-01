/**
 * Every report filed against one line, for the popover on an explorer row.
 *
 * A sibling of /api/reports rather than a GET on it, for the reason /resolve is: that path's
 * POST is open to the internet, and these are the bodies strangers wrote, which only the
 * people who triage them may read. The count stays public on the row; this does not.
 *
 * Resolved reports come back too, after the open ones, so a report closed by mistake from
 * the row can be reopened from the same place.
 */
import { requireQueues } from "@/lib/generation/authz";
import { reportsForLine } from "@/lib/reports/store";
import { isSource } from "@/lib/sections";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { lang, queues, denied } = await requireQueues(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const source = params.get("source");
  const lineId = params.get("lineId");
  if (!isSource(source)) {
    return Response.json({ error: "unknown source" }, { status: 400 });
  }
  if (!lineId) {
    return Response.json({ error: "lineId is required" }, { status: 400 });
  }


  return Response.json({ reports: await reportsForLine(source, lineId, lang, queues) });
}

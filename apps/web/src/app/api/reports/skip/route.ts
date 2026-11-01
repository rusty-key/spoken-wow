/**
 * Putting reports aside in the sorting queue, and bringing them back.
 *
 * A sibling of /api/reports for the reason /resolve is: that path's POST is open to the
 * internet. A skip is the triager's own bookkeeping and changes nothing anybody else sees,
 * so it needs no more than the grant to read the reports in the first place.
 */
import { requireQueues } from "@/lib/generation/authz";
import { resetSkips, skipReports } from "@/lib/reports/store";
import { isSource } from "@/lib/sections";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { lang, session, queues, denied } = await requireQueues(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
  if (!ids.length) return Response.json({ error: "ids are required" }, { status: 400 });

  return Response.json({ skipped: await skipReports(session.user.id, ids, lang, queues) });
}

export async function DELETE(request: Request) {
  const { lang, session, denied } = await requireQueues(request);
  if (denied) return denied;

  const source = new URL(request.url).searchParams.get("source");
  if (!isSource(source)) return Response.json({ error: "unknown source" }, { status: 400 });

  return Response.json({ reset: await resetSkips(session.user.id, source, lang) });
}

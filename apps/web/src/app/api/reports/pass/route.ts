/**
 * Not a verb on /api/reports, whose POST is open to the internet.
 *
 * Gated on the queue it is leaving: a report can be handed on only by whoever it waits for.
 */
import { requireReportQueue } from "@/lib/reports/access";
import { isQueue } from "@/lib/reports/reports";
import { setQueue } from "@/lib/reports/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; to?: unknown };

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "unknown report" }, { status: 404 });
  }
  if (!isQueue(body.to)) {
    return Response.json({ error: "unknown queue" }, { status: 400 });
  }

  const { place, session, denied } = await requireReportQueue(id);
  if (denied) return denied;

  const report = place && (await setQueue(id, body.to, session.user.id, place.lang));
  if (!report) {
    return Response.json({ error: "unknown report" }, { status: 404 });
  }
  return Response.json({ report });
}

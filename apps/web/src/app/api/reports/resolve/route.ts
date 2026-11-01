/**
 * Changing a report's status.
 *
 * A separate route rather than a second verb on /api/reports. That path's POST is open to the
 * whole internet and this one must never be; two verbs on one path with opposite access rules
 * is the arrangement a later edit quietly breaks.
 *
 * Whoever works the report's queue in its language rather than an admin: a report they have read
 * and dismissed should not need an admin to close.
 */
import { requireReportQueue } from "@/lib/reports/access";
import { isStatus } from "@/lib/reports/reports";
import { setStatus } from "@/lib/reports/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; status?: unknown };

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "unknown report" }, { status: 404 });
  }
  if (!isStatus(body.status)) {
    return Response.json({ error: "unknown status" }, { status: 400 });
  }

  const { place, session, denied } = await requireReportQueue(id);
  if (denied) return denied;
  if (place === null) {
    return Response.json({ error: "unknown report" }, { status: 404 });
  }

  const report = await setStatus(id, body.status, session.user.id, place.lang);
  if (!report) {
    return Response.json({ error: "unknown report" }, { status: 404 });
  }
  return Response.json({ report });
}

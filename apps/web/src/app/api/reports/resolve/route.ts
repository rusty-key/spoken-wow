/**
 * Changing a report's status.
 *
 * A separate route rather than a second verb on /api/reports. That path's POST is open to the
 * whole internet and this one must never be; two verbs on one path with opposite access rules
 * is the arrangement a later edit quietly breaks.
 *
 * Whoever works the report's queue in its language rather than an admin: these are the people
 * who already act on its lines, and a report they have read and dismissed should not need an
 * admin to close. A Portuguese report is a Portuguese translator's, and not an English one's.
 */
import { requireCapability } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import { isStatus, queueCapability } from "@/lib/reports/reports";
import { reportPlace, setStatus } from "@/lib/reports/store";

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

  // The id is checked for existence only after the permission, so a member learns nothing
  // about which ids exist.
  const place = await reportPlace(id);
  const { session, denied } = await requireCapability(
    queueCapability(place?.queue ?? "audio"),
    place?.lang ?? BASE_LANG,
  );
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

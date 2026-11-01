/**
 * Passing a report between a language's text maintainers and its team. A sibling of
 * /api/reports for the reason /resolve is: that path's POST is open to the internet.
 *
 * Gated on the queue it is leaving: a report can be handed on only by whoever it waits for.
 */
import { requireCapability } from "@/lib/generation/authz";
import { BASE_LANG } from "@/lib/lang";
import { isQueue, queueCapability } from "@/lib/reports/reports";
import { reportPlace, setQueue } from "@/lib/reports/store";

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

  // The permission before the existence check, as resolve does.
  const place = await reportPlace(id);
  const { session, denied } = await requireCapability(
    queueCapability(place?.queue ?? "audio"),
    place?.lang ?? BASE_LANG,
  );
  if (denied) return denied;

  const report = place && (await setQueue(id, body.to, session.user.id, place.lang));
  if (!report) {
    return Response.json({ error: "unknown report" }, { status: 404 });
  }
  return Response.json({ report });
}

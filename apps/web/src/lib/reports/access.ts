/** The gate on a route acting on one report by id. */
import { requireCapability } from "@/lib/generation/authz";
import { BASE_LANG, type Lang } from "@/lib/lang";

import { queueCapability, type Queue } from "./reports";
import { reportPlace } from "./store";

/**
 * The session, or a 403, for whoever works the report's queue in its language. The permission
 * comes before the existence check, so a null `place` (no such id) only reaches somebody already
 * allowed, and a member learns nothing about which ids exist.
 */
export async function requireReportQueue(id: number) {
  const place: { lang: Lang; queue: Queue } | null = await reportPlace(id);
  const guard = await requireCapability(queueCapability(place?.queue ?? "audio"), place?.lang ?? BASE_LANG);
  if (guard.denied) return { place: null, session: null, denied: guard.denied };
  return { place, session: guard.session, denied: null };
}

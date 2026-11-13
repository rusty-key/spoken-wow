import { requireCapability } from "@/lib/generation/authz";
import { BASE_LANG, type Lang } from "@/lib/lang";

import { queueCapability, type Queue } from "./reports";
import { reportPlace } from "./store";

/**
 * The session, or a 403, for whoever works the report's queue. A null `place` (no such id) reaches
 * only somebody already allowed, so a member learns nothing about which ids exist.
 */
export async function requireReportQueue(id: number) {
  const place: { lang: Lang; queue: Queue } | null = await reportPlace(id);
  const guard = await requireCapability(queueCapability(place?.queue ?? "audio"), place?.lang ?? BASE_LANG);
  if (guard.denied) return { place: null, session: null, denied: guard.denied };
  return { place, session: guard.session, denied: null };
}

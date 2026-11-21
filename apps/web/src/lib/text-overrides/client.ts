import { withLang, type Lang } from "@/lib/lang";

import type { NarratedSource } from "./types";

const ROUTE = "/api/text-overrides";

/** Both resolve with the route's response, whatever its status; a network failure rejects. */
export function saveTextOverride(lang: Lang, source: NarratedSource, lineId: string, text: string): Promise<Response> {
  return fetch(withLang(lang, `${ROUTE}?source=${source}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lineId, text }),
  });
}

export function dropTextOverride(lang: Lang, source: NarratedSource, lineId: string): Promise<Response> {
  return fetch(withLang(lang, `${ROUTE}?source=${source}&lineId=${encodeURIComponent(lineId)}`), { method: "DELETE" });
}

import type { Lang } from "@/lib/lang";

/** Both resolve with the route's response, whatever its status; a network failure rejects. */
export function saveOverride(lang: Lang, file: string, lineId: string, text: string): Promise<Response> {
  return fetch(`/api/quests/lines/override?lang=${lang}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, lineId, text }),
  });
}

export function dropOverride(lang: Lang, file: string): Promise<Response> {
  return fetch(`/api/quests/lines/override?lang=${lang}&file=${encodeURIComponent(file)}`, { method: "DELETE" });
}

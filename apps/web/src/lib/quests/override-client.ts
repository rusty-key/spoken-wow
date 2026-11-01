/** The override route from the browser. Answers the route's response; a network failure rejects. */
export function saveOverride(file: string, lineId: string, text: string): Promise<Response> {
  return fetch("/api/quests/lines/override", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, lineId, text }),
  });
}

export function dropOverride(file: string): Promise<Response> {
  return fetch(`/api/quests/lines/override?file=${encodeURIComponent(file)}`, { method: "DELETE" });
}

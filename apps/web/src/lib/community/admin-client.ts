/**
 * The admin's pack routes from the browser. Each answers ok, or the route's own reason, so a
 * 409 for a submission another admin just decided reads as that and not as a failure.
 */
async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { ok: false, error: "Could not reach the server." };
  if (response.ok) return { ok: true };
  const { error } = (await response.json().catch(() => ({}))) as { error?: string };
  return { ok: false, error: error ?? "Something went wrong." };
}

export const decideSubmission = (id: string, decision: "approve" | "reject", reason?: string) =>
  send(`/api/admin/packs/submissions/${encodeURIComponent(id)}`, "POST", { decision, reason });

export const updatePack = (id: string, change: { ownerId?: string | null; listed?: boolean }) =>
  send(`/api/admin/packs/${encodeURIComponent(id)}`, "PATCH", change);

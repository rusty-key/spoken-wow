/** What a refusing route answers: its reason, and per-field reasons for a form. */
export type Refusal = { error?: string; errors?: Record<string, string> };

/**
 * A JSON request from the browser that answers ok, or the route's own reason, so a 409 for
 * something another admin just changed reads as that and not as a failure. `body` is there
 * whenever the server answered, so a caller can tell an unreachable server apart.
 */
export async function send(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<{ ok: true } | { ok: false; error: string; body?: Refusal }> {
  const response = await fetch(
    url,
    body === undefined
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  ).catch(() => null);
  if (!response) return { ok: false, error: "Could not reach the server." };
  if (response.ok) return { ok: true };
  const answer = (await response.json().catch(() => ({}))) as Refusal;
  return { ok: false, error: answer.error ?? "Something went wrong.", body: answer };
}

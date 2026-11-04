import type { GrantRow } from "@/lib/grants/store";

/**
 * /api/grants from the browser. Every save answers with the whole listing, or says why not;
 * `error` is undefined when the route gave no reason, so each table keeps its own wording.
 */
export async function sendGrants(
  method: "PUT" | "DELETE",
  target: string,
  body?: unknown,
): Promise<{ grants: GrantRow[] } | { grants?: undefined; error?: string }> {
  const response = await fetch(target, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { error: "Could not reach the server." };
  const data = (await response.json().catch(() => ({}))) as { grants?: GrantRow[]; error?: string };
  return response.ok && data.grants ? { grants: data.grants } : { error: data.error };
}

export const giveGrants = (email: string, lang: string, capabilities: readonly string[]) =>
  sendGrants("PUT", "/api/grants", { email, lang, capabilities });

export const takeGrant = (userId: string, lang: string, capability: string) =>
  sendGrants("DELETE", `/api/grants?${new URLSearchParams({ userId, lang, capability })}`);

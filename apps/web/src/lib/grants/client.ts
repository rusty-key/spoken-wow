import type { GrantRow } from "@/lib/grants/store";
import type { InviteRow } from "@/lib/invites/store";

/** What every /api/grants and /api/invites write answers; `invited` only to a PUT. */
export type Listing = { grants: GrantRow[]; invites: InviteRow[]; invited?: boolean };

/**
 * /api/grants from the browser. Every save answers with the whole listing, or says why not;
 * `error` is undefined when the route gave no reason, so each table keeps its own wording.
 */
export async function sendGrants(
  method: "GET" | "PUT" | "DELETE" | "POST",
  target: string,
  body?: unknown,
): Promise<Listing | { grants?: undefined; invites?: undefined; invited?: undefined; error?: string }> {
  const response = await fetch(target, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!response) return { error: "Could not reach the server." };
  const data = (await response.json().catch(() => ({}))) as Partial<Listing> & { error?: string };
  return response.ok && data.grants
    ? { grants: data.grants, invites: data.invites ?? [], invited: data.invited }
    : { error: data.error };
}

export const giveGrants = (email: string, lang: string, capabilities: readonly string[]) =>
  sendGrants("PUT", "/api/grants", { email, lang, capabilities });

export const takeGrant = (userId: string, lang: string, capability: string) =>
  sendGrants("DELETE", `/api/grants?${new URLSearchParams({ userId, lang, capability })}`);

export const resendInvite = (id: string) => sendGrants("POST", `/api/invites/${id}/resend`);

export const revokeInvite = (id: string) => sendGrants("DELETE", `/api/invites/${id}`);

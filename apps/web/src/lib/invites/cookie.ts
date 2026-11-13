/**
 * The invite token between the emailed link and the accept button.
 *
 * The link opens /api/invites/open, which keeps the token in this cookie and redirects to a
 * page with no token in its address, so it reaches no history entry, Referer, access log or
 * link preview beyond that one hop. httpOnly: nothing in the page needs to read it.
 */
import "server-only";

import { cookies } from "next/headers";

import { lookupInvite, type InviteLookup } from "./store";

export const INVITE_COOKIE = "spoken_invite";

const HOUR_S = 60 * 60;

function serialize(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${INVITE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export const setInviteCookie = (token: string) => serialize(token, HOUR_S);

/** The invite this browser's cookie names, or null when it names none. */
export async function currentInvite(): Promise<InviteLookup | null> {
  const token = (await cookies()).get(INVITE_COOKIE)?.value;
  return token ? lookupInvite(token) : null;
}

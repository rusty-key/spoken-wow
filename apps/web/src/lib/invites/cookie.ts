/**
 * The invite token between the emailed link and the accept button.
 *
 * The link opens /api/invites/open, which keeps the token in this cookie and redirects to a
 * page with no token in its address, so it reaches no history entry, Referer, access log or
 * link preview beyond that one hop. httpOnly: nothing in the page needs to read it.
 */
export const INVITE_COOKIE = "spoken_invite";

const HOUR_S = 60 * 60;

function serialize(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${INVITE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export const setInviteCookie = (token: string) => serialize(token, HOUR_S);

/** The token in a request's Cookie header, or null. */
export function inviteTokenIn(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === INVITE_COOKIE) {
      const value = decodeURIComponent(rest.join("="));
      return value || null;
    }
  }
  return null;
}

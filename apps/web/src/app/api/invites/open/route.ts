/**
 * Where the emailed link points: keeps the token in a cookie and moves on to /invite without it.
 *
 * Always the English /invite: the invite's own language may still be switched off, and its
 * prefix answers 404 to anyone but a site admin. Relative, so the redirect stays on the host the
 * browser used, behind the proxy too.
 */
import { setInviteCookie } from "@/lib/invites/cookie";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const headers = new Headers({ Location: "/invite" });
  if (token) headers.append("Set-Cookie", setInviteCookie(token));
  return new Response(null, { status: 303, headers });
}

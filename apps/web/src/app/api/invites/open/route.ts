/**
 * Where the emailed link points: keeps the token in a cookie and moves on to /invite without it.
 */
import { setInviteCookie } from "@/lib/invites/cookie";
import { lookupInvite } from "@/lib/invites/store";
import { isLang, localeHref } from "@/lib/lang";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const invite = token ? await lookupInvite(token) : null;
  const path = localeHref(invite && isLang(invite.lang) ? invite.lang : "enUS", "/invite");
  // Relative, so the redirect stays on the host the browser used, behind the proxy too.
  const headers = new Headers({ Location: path });
  if (token) headers.append("Set-Cookie", setInviteCookie(token));
  return new Response(null, { status: 303, headers });
}

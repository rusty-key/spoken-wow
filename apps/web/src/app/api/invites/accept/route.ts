/**
 * Accepting an invite: the signed-in account must be the one whose address it names.
 *
 * A button on /invite posts here, not the page load, so a link preview cannot use the invite up.
 */
import { cookies, headers } from "next/headers";

import { bad, bodyOf, objectOf } from "@/lib/api-body";
import { auth } from "@/lib/auth";
import { INVITE_COOKIE } from "@/lib/invites/cookie";
import { capabilityLabel } from "@/lib/permissions";
import { acceptInvite } from "@/lib/invites/store";

export const dynamic = "force-dynamic";

const STATUS = {
  unknown: 404,
  changed: 409,
  expired: 410,
  revoked: 410,
  accepted: 409,
  "wrong-email": 403,
  "inviter-cannot-grant": 409,
} as const;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "sign in to accept the invite" }, { status: 401 });
  const id = objectOf(await bodyOf(request))?.id;
  if (typeof id !== "string") return bad("expected { id }");

  const token = (await cookies()).get(INVITE_COOKIE)?.value;
  if (!token) return Response.json({ error: "This invite link is not valid any more.", reason: "unknown" }, { status: 404 });

  const outcome = await acceptInvite(token, session.user, id);
  // The cookie stays: the token is spent now, and the refreshed /invite needs it to say "You're in".
  if (outcome.ok) return Response.json({ lang: outcome.lang, capabilities: outcome.capabilities });

  const { reason } = outcome;
  const who = outcome.inviterName ?? "The person who invited you";
  const error = {
    unknown: "This link is not valid any more.",
    changed: "This tab shows an older invite than the link you opened last; reload the page.",
    expired: "This invite has expired; ask for a new one.",
    revoked: "This invite was withdrawn.",
    accepted: "This invite was accepted already.",
    "wrong-email": `This invite is for ${outcome.email}; you are signed in as ${session.user.email}.`,
    "inviter-cannot-grant": `${who} can no longer give ${outcome.capability ? capabilityLabel(outcome.capability) : "that"}; ask a team admin to send a new invite.`,
  }[reason];
  return Response.json({ error, reason }, { status: STATUS[reason] });
}

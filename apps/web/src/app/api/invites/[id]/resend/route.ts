/** Sending an invite again, with a new link: the old one stops working. */
import { headers } from "next/headers";

import { recordActivity } from "@/lib/activity/store";
import { auth } from "@/lib/auth";
import { sendInviteEmail } from "@/lib/email";
import { viewerOf } from "@/lib/grants/store";
import { listingFor } from "@/lib/invites/listing";
import { InviteGoneError, InviteRateError, inviteUrl, openInvite, resendInvite } from "@/lib/invites/store";
import { isLang, langName } from "@/lib/lang";
import { textByTeam } from "@/lib/languages/store";
import { canGrant, capabilityLabel, isAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await viewerOf(session);
  if (!session || !viewer) return Response.json({ error: "not allowed" }, { status: 403 });

  const { id } = await params;
  const invite = /^[0-9a-f-]{36}$/i.test(id) ? await openInvite(id) : null;
  if (!invite || !isLang(invite.lang)) return Response.json({ error: "no such invite" }, { status: 404 });
  const lang = invite.lang;
  const byTeam = await textByTeam(lang);
  if (!invite.capabilities.every((capability) => canGrant(viewer, capability, lang, byTeam))) {
    return Response.json({ error: "not allowed" }, { status: 403 });
  }

  try {
    const sent = await resendInvite(id, !isAdmin(viewer.role));
    await recordActivity({
      kind: "invite.resent",
      lang,
      subject: id,
      actorId: session.user.id,
      detail: { email: invite.email },
    });
    sendInviteEmail(invite.email, {
      inviterName: invite.invitedByName ?? "A Spoken team member",
      langName: langName(lang),
      capabilities: sent.invite.capabilities.map(capabilityLabel),
      url: inviteUrl(sent.token),
    });
  } catch (error) {
    if (error instanceof InviteGoneError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof InviteRateError) {
      console.warn(`invites: resend of ${id} refused: ${error.message}`);
      return Response.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }
  return listingFor(viewer);
}

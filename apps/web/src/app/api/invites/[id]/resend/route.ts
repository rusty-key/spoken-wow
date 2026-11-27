/** Sending an invite again, with a new link: the old one stops working. */
import { listingFor } from "@/lib/invites/listing";
import { manageableInvite } from "@/lib/invites/manage";
import { emailInvite, InviteGoneError, InviteRateError, InviteSendError, resendInvite } from "@/lib/invites/store";
import { isAdmin } from "@/lib/permissions";
import { UPSTREAM_FAILED } from "@/lib/upstream-failed";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await manageableInvite(id);
  if (found instanceof Response) return found;
  const { session, viewer } = found;

  try {
    await resendInvite(id, !isAdmin(viewer.role), session.user.id, emailInvite);
  } catch (error) {
    if (error instanceof InviteSendError) return Response.json({ error: error.message }, { status: UPSTREAM_FAILED });
    if (error instanceof InviteGoneError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof InviteRateError) {
      console.warn(`invites: resend of ${id} refused: ${error.message}`);
      return Response.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }
  return listingFor(viewer, session.user.id);
}

/** Sending an invite again, with a new link: the old one stops working. */
import { listingFor } from "@/lib/invites/listing";
import { manageableInvite } from "@/lib/invites/manage";
import { emailInvite, InviteGoneError, InviteRateError, resendInvite } from "@/lib/invites/store";
import { isAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await manageableInvite(id);
  if (found instanceof Response) return found;
  const { session, viewer } = found;

  try {
    const sent = await resendInvite(id, !isAdmin(viewer.role), session.user.id);
    emailInvite(sent.invite, sent.token);
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

/** Revoking an invite. Whoever may hand out what it names may take it back. */
import { listingFor } from "@/lib/invites/listing";
import { manageableInvite, noSuchInvite } from "@/lib/invites/manage";
import { revokeInvite } from "@/lib/invites/store";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await manageableInvite(id);
  if (found instanceof Response) return found;

  const revoked = await revokeInvite(id, found.session.user.id);
  if (!revoked) return noSuchInvite();
  return listingFor(found.viewer);
}

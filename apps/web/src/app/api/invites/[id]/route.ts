/** Revoking an invite. Whoever may hand out what it names may take it back. */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { viewerOf } from "@/lib/grants/store";
import { listingFor } from "@/lib/invites/listing";
import { openInvite, revokeInvite } from "@/lib/invites/store";
import { isLang } from "@/lib/lang";
import { textByTeam } from "@/lib/languages/store";
import { canGrant } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await viewerOf(session);
  if (!session || !viewer) return Response.json({ error: "not allowed" }, { status: 403 });

  const { id } = await params;
  const invite = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? await openInvite(id) : null;
  if (!invite || !isLang(invite.lang)) return Response.json({ error: "no such invite" }, { status: 404 });
  const lang = invite.lang;
  const byTeam = await textByTeam(lang);
  if (!invite.capabilities.every((capability) => canGrant(viewer, capability, lang, byTeam))) {
    return Response.json({ error: "not allowed" }, { status: 403 });
  }

  const revoked = await revokeInvite(id, session.user.id);
  if (!revoked) return Response.json({ error: "no such invite" }, { status: 404 });
  return listingFor(viewer);
}

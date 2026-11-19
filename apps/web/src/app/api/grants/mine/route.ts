/**
 * What the signed-in person holds in each language, for the explorers to decide what to
 * draw. The server checks again on every write: this only saves offering a control that
 * would answer 403.
 *
 * A site admin also gets the community pack submissions and the teams' releases waiting for
 * review, for the badges on the header's Admin link and the admin tabs. It rides on this request, which every page already makes once,
 * rather than costing one of its own or a session read in the layout.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { pendingCount } from "@/lib/community/store";
import { grantsOf } from "@/lib/grants/store";
import { isAdmin } from "@/lib/permissions";
import { waitingCount } from "@/lib/releases/review";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ grants: [] });
  const owner = isAdmin(session.user.role);
  const [grants, pendingPacks, pendingReleases] = await Promise.all([
    grantsOf(session.user.id),
    owner ? pendingCount() : 0,
    owner ? waitingCount() : 0,
  ]);
  return Response.json({ grants, pendingPacks, pendingReleases });
}

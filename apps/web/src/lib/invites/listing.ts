/**
 * What /api/grants and /api/invites answer: the grants and open invites in the languages the
 * viewer administers.
 */
import "server-only";

import { listGrants } from "@/lib/grants/store";
import { isAdmin, langsWhere, type Viewer } from "@/lib/permissions";

import { listInvites } from "./store";

export async function listingFor(viewer: Viewer, extra: Record<string, unknown> = {}): Promise<Response> {
  const langs = langsWhere(viewer, "admin");
  if (langs.length === 0) return Response.json({ error: "not allowed" }, { status: 403 });
  const scope = isAdmin(viewer.role) ? undefined : langs;
  const [grants, invites] = await Promise.all([listGrants(scope), listInvites(scope)]);
  return Response.json({ grants, invites, ...extra });
}

/**
 * What /api/grants and /api/invites answer: the grants and open invites in the languages the
 * viewer administers.
 */
import "server-only";

import { listGrants, listTeamGrants, type GrantRow } from "@/lib/grants/store";
import { isAdmin, langsWhere, type Viewer } from "@/lib/permissions";
import { memberTeams } from "@/lib/teams/acting";
import type { TeamId } from "@/lib/teams/store";

import { listInvites } from "./store";

export const notAllowed = () => Response.json({ error: "not allowed" }, { status: 403 });

/**
 * The grants in `langs` that `userId` sees: all of them for a site owner. Anyone else sees, in
 * each, their own team's rows, and the `text` rows where they are an admin of the privileged team.
 */
export async function visibleGrants(viewer: Viewer, userId: string, langs: readonly string[]): Promise<GrantRow[]> {
  if (isAdmin(viewer.role)) return listGrants([...langs]);
  const teams = await memberTeams(userId);
  const own = new Map<string, TeamId>();
  for (const lang of langs) {
    const team = teams.get(lang);
    if (team) own.set(lang, team);
  }
  const textLangs = langs.filter((lang) =>
    viewer.grants.some((grant) => grant.lang === lang && grant.capability === "admin" && grant.privileged !== false),
  );
  return listTeamGrants(own, textLangs);
}

export async function listingFor(
  viewer: Viewer,
  userId: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const langs = langsWhere(viewer, "admin");
  if (langs.length === 0) return notAllowed();
  const global = isAdmin(viewer.role);
  const [grants, invites] = await Promise.all([
    global ? listGrants() : visibleGrants(viewer, userId, langs),
    listInvites(global ? undefined : langs),
  ]);
  return Response.json({ grants, invites, ...extra });
}

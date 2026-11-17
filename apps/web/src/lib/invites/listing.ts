/**
 * What /api/grants and /api/invites answer: the grants and open invites in the languages the
 * viewer administers.
 */
import "server-only";

import { listGrants, listTeamGrants, type GrantRow } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { adminsPrivileged, isAdmin, langsWhere, type Viewer } from "@/lib/permissions";
import { memberTeams } from "@/lib/teams/acting";
import { orPrivileged, type TeamId } from "@/lib/teams/store";

import { listInvites, type InviteRow } from "./store";

export const notAllowed = () => Response.json({ error: "not allowed" }, { status: 403 });

type Teams = ReadonlyMap<string, TeamId>;

/** The teams the viewer works in, by language, as memberTeams reads them; none read for a site owner. */
export async function viewerTeams(viewer: Viewer, userId: string): Promise<Teams> {
  return isAdmin(viewer.role) ? new Map() : memberTeams(userId);
}

/**
 * The grants in `langs` that the viewer sees: all of them for a site owner. Anyone else sees, in
 * each, their own team's rows, and the `text` rows where they are an admin of the privileged team.
 */
export async function visibleGrants(viewer: Viewer, teams: Teams, langs: readonly string[]): Promise<GrantRow[]> {
  if (isAdmin(viewer.role)) return listGrants([...langs]);
  const own = new Map<string, TeamId>();
  for (const lang of langs) {
    const team = teams.get(lang);
    if (team) own.set(lang, team);
  }
  const textLangs = langs.filter((lang) => adminsPrivileged(viewer, lang));
  return listTeamGrants(own, textLangs);
}

/**
 * The open invites in `langs` that the viewer sees: all of them for a site owner, and for anyone
 * else, in each, the ones that join their own team there (the privileged team when they are in
 * none).
 */
export async function visibleInvites(viewer: Viewer, teams: Teams, langs: readonly string[]): Promise<InviteRow[]> {
  if (isAdmin(viewer.role)) return listInvites([...langs]);
  const byTeam = new Map<TeamId, string[]>();
  for (const lang of langs) {
    const team = await orPrivileged(teams.get(lang), lang as Lang);
    if (team) byTeam.set(team, [...(byTeam.get(team) ?? []), lang]);
  }
  const lists = await Promise.all([...byTeam].map(([team, inTeam]) => listInvites(inTeam, team)));
  if (lists.length === 1) return lists[0];
  return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listingFor(
  viewer: Viewer,
  userId: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const langs = langsWhere(viewer, "admin");
  if (langs.length === 0) return notAllowed();
  const teams = await viewerTeams(viewer, userId);
  const [grants, invites] = await Promise.all([
    visibleGrants(viewer, teams, langs),
    visibleInvites(viewer, teams, langs),
  ]);
  return Response.json({ grants, invites, ...extra });
}

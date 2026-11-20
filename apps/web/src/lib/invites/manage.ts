/**
 * The checks a route runs before it changes an open invite: a signed-in viewer, an invite that is
 * open and, but for a site owner, in the viewer's own team, and the right to hand out everything
 * it names.
 */
import "server-only";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { refusedGrant, viewerOf } from "@/lib/grants/store";
import type { Lang } from "@/lib/lang";
import { knownLang } from "@/lib/languages/catalogue";
import { isAdmin, type Viewer } from "@/lib/permissions";
import { teamIn } from "@/lib/teams/acting";
import { onlyTeamOf } from "@/lib/teams/store";
import { isUuid } from "@/lib/uuid";

import { notAllowed } from "./listing";
import { openInvite } from "./store";

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export type Manageable = { session: Session; viewer: Viewer };

export const noSuchInvite = () => Response.json({ error: "no such invite" }, { status: 404 });

/** The open invite `id` and who may change it, or the 403 or 404 to answer instead. */
export async function manageableInvite(id: string): Promise<Manageable | Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await viewerOf(session);
  if (!session || !viewer) return notAllowed();
  const invite = isUuid(id) ? await openInvite(id) : null;
  if (!invite || !(await knownLang(invite.lang))) return noSuchInvite();
  // Another team's invite is not there for this viewer, so it answers as a missing one. Somebody
  // in no team of a language with one team acts as that team.
  if (!isAdmin(viewer.role)) {
    const team = (await teamIn(session.user.id, invite.lang)) ?? (await onlyTeamOf(invite.lang as Lang));
    if (team !== invite.teamId) return noSuchInvite();
  }
  if (await refusedGrant(viewer, invite.capabilities, invite.lang)) return notAllowed();
  return { session, viewer };
}

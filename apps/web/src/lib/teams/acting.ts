/**
 * The team a person works as in each language, from team_member; for a site owner, the team
 * the acting cookie picks wins. With a second team it need not be the privileged one. Outside a
 * request (worker, script, approval for someone else), name the person with asActor or the team
 * with asTeams, or the privileged team is used.
 */
import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { headers } from "next/headers";
import type { ClientBase } from "pg";
import { cache } from "react";

import { db, type TeamId } from "@/lib/db";
import { isAdmin } from "@/lib/permissions";

type Teams = ReadonlyMap<string, TeamId>;

const NONE: Teams = new Map();

const scope = new AsyncLocalStorage<Teams>();

// The privileged team's rows sort last, so a person in two teams of one language acts as it.
export async function memberTeams(userId: string, client?: Pick<ClientBase, "query">): Promise<Map<string, TeamId>> {
  const { rows } = await (client ?? db()).query<{ lang: string; teamId: TeamId }>(
    `select m."lang", m."teamId" from "team_member" m
       left join "team_language" tl on tl."teamId" = m."teamId" and tl."lang" = m."lang"
      where m."userId" = $1
      order by tl."privileged" nulls first`,
    [userId],
  );
  return new Map(rows.map((row) => [row.lang, row.teamId]));
}

export async function teamIn(userId: string, lang: string, client?: Pick<ClientBase, "query">): Promise<TeamId | null> {
  return (await memberTeams(userId, client)).get(lang) ?? null;
}

export function asTeams<T>(teams: Teams, work: () => Promise<T>): Promise<T> {
  return scope.run(teams, work);
}

/** `work` acting as `team` in `lang` alone; as no team when either is missing. */
export function asTeam<T>(lang: string | null, team: TeamId | null | undefined, work: () => Promise<T>): Promise<T> {
  return asTeams(lang && team ? new Map([[lang, team]]) : NONE, work);
}

export async function asActor<T>(userId: string, work: () => Promise<T>): Promise<T> {
  return asTeams(await memberTeams(userId), work);
}

/**
 * The session's person's teams; for a site owner, overlaid with the teams the acting cookie
 * picks, the role read from the session on every request. Both loaded on first use, not
 * imported: the session reaches lib/auth, whose activity hook reaches lib/teams/store, which
 * imports this module, and the cookie's module imports lib/teams/store. A script or the worker
 * never loads them.
 */
const sessionTeams = cache(async (): Promise<Teams> => {
  const { currentSession } = await import("@/lib/session");
  const session = await currentSession();
  if (!session) return NONE;
  const member = await memberTeams(session.user.id);
  if (!isAdmin(session.user.role)) return member;
  const { chosenTeams } = await import("./acting-cookie");
  const chosen = await chosenTeams();
  return chosen.size ? new Map([...member, ...chosen]) : member;
});

/** Next's refusal of headers() where there is no request: the worker, a script, a test. */
function outsideRequest(error: unknown): boolean {
  return error instanceof Error && error.message.includes("was called outside a request scope");
}

/** The innermost asTeams or asActor; else the session's person's teams; else none. */
export async function actingTeams(): Promise<Teams> {
  const scoped = scope.getStore();
  if (scoped) return scoped;
  try {
    await headers();
  } catch (error) {
    if (outsideRequest(error)) return NONE;
    throw error;
  }
  return sessionTeams();
}

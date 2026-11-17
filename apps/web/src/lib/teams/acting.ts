/**
 * The team a person works as in each language: the one team_member puts them in, which in a
 * language with a second team need not be the privileged one.
 *
 * A request reads it from the session. Work done for a person outside their request (the
 * worker, a script, an approval acting for someone else) names them with asActor, or names the
 * team with asTeams. Anything else acts as no team in particular, and so as the privileged team.
 */
import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { headers } from "next/headers";
import type { ClientBase } from "pg";
import { cache } from "react";

import { db, type TeamId } from "@/lib/db";

type Teams = ReadonlyMap<string, TeamId>;

const NONE: Teams = new Map();

const scope = new AsyncLocalStorage<Teams>();

/**
 * Each language `userId` works on, and the team they work on it in. Rows of a team that holds
 * the language privileged sort last, so a person in two teams of one language (data from before
 * the one-team rule) acts as the privileged one.
 */
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

/** The team `userId` works on `lang` in, or null when they work on it in none. */
export async function teamIn(userId: string, lang: string, client?: Pick<ClientBase, "query">): Promise<TeamId | null> {
  return (await memberTeams(userId, client)).get(lang) ?? null;
}

/** `work` acting as `teams`, whoever the request's session is. */
export function asTeams<T>(teams: Teams, work: () => Promise<T>): Promise<T> {
  return scope.run(teams, work);
}

/** `work` acting as `team` in `lang` alone; as no team when either is missing. */
export function asTeam<T>(lang: string | null, team: TeamId | null | undefined, work: () => Promise<T>): Promise<T> {
  return asTeams(lang && team ? new Map([[lang, team]]) : NONE, work);
}

/** `work` acting as the teams `userId` works in. */
export async function asActor<T>(userId: string, work: () => Promise<T>): Promise<T> {
  return asTeams(await memberTeams(userId), work);
}

/**
 * Loaded on first use, not imported: the session reaches lib/auth, whose activity hook reaches
 * lib/teams/store, which imports this module. A script or the worker never loads it.
 */
const sessionTeams = cache(async (): Promise<Teams> => {
  const { currentSession } = await import("@/lib/session");
  const session = await currentSession();
  return session ? memberTeams(session.user.id) : NONE;
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

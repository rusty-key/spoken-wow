/**
 * Which team owns a language, memoised for a minute. Two pm2 workers cannot share an
 * invalidation, so the short expiry bounds how stale the other worker can be, and a miss is
 * read again so a language the other worker just switched on resolves at once.
 */
import "server-only";

import type { ClientBase, PoolClient, QueryResult, QueryResultRow } from "pg";

import { ALL_TEAMS, query, queryIn, type TeamId, withTeam } from "@/lib/db";
import { BASE_LANG, CODES, type Lang } from "@/lib/lang";

import { listenUnlessTesting } from "./listen";

export type { TeamId };

/** A language with no privileged team: nothing can be written for it until it has one. */
export class NoTeamError extends Error {
  constructor(readonly lang: string) {
    super(`${lang} has no team`);
    this.name = "NoTeamError";
  }
}

const TTL_MS = 60_000;
/** How old the memo must be for a miss to read the mapping again: at most once a second. */
const MISS_REFRESH_MS = 1_000;

let cached: { at: number; langs: Promise<Map<Lang, TeamId>> } | null = null;

/** Drops the memo. For a write that changes the mapping, and for tests. */
export function forgetTeams(): void {
  cached = null;
}

export function teamLangs(): Promise<Map<Lang, TeamId>> {
  listenUnlessTesting();
  if (cached && Date.now() - cached.at < TTL_MS) return cached.langs;
  const langs = query<{ lang: Lang; teamId: TeamId }>(
    `select "lang", "teamId" from "team_language" where "privileged"`,
  ).then((rows) => new Map(rows.map((row) => [row.lang, row.teamId])));
  cached = { at: Date.now(), langs };
  // A failed read must not be served for the next minute.
  langs.catch(() => {
    if (cached?.langs === langs) cached = null;
  });
  return langs;
}

/** The privileged team of `lang`, or undefined for a language nobody owns. A miss reads again once. */
async function ownerOf(lang: Lang): Promise<TeamId | undefined> {
  return (await freshOwners([lang])).get(lang);
}

/** teamLangs, read again once (unless the memo is fresh) when any of `langs` has no team. */
export async function freshOwners(langs: readonly (Lang | null)[]): Promise<Map<Lang, TeamId>> {
  const owners = await teamLangs();
  const missing = langs.some((lang) => lang && !owners.has(lang));
  if (!missing || !cached || Date.now() - cached.at < MISS_REFRESH_MS) return owners;
  forgetTeams();
  return teamLangs();
}

export async function teamOf(lang: Lang): Promise<TeamId> {
  const team = await ownerOf(lang);
  if (!team) throw new NoTeamError(lang);
  return team;
}

/**
 * For reads and writes that must work on an unowned or site-wide language; ALL_TEAMS writes a
 * null team. Also for shared writes logged unowned, since only ALL_TEAMS may write that row.
 */
export async function ownerOrAll(lang: Lang | null): Promise<TeamId | typeof ALL_TEAMS> {
  return (lang && (await ownerOf(lang))) || ALL_TEAMS;
}

/**
 * The owner of `lang`, or the english team, where an unowned language lands when switched on.
 * For what every team keeps a copy of, so an unowned language reads English's.
 */
export async function teamOrEnglish(lang: Lang): Promise<TeamId> {
  return (await ownerOf(lang)) ?? teamOf(BASE_LANG);
}

/** How a per-team write is made, so the row takes its "teamId" from the column default. */
export async function asTeamOf<T>(lang: Lang, work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTeam(await teamOf(lang), work);
}

/** One statement as the team that owns `lang`, its whole result kept: writes check rowCount. */
export async function queryAs<T extends QueryResultRow = QueryResultRow>(
  lang: Lang,
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return asTeamOf(lang, (client) => client.query<T>(text, params));
}

/**
 * A language nobody owns answers no rows rather than throwing: every language with rows has a
 * team, and an admin's look at a language never switched on still renders an empty explorer.
 */
export async function readAs<T extends QueryResultRow = QueryResultRow>(
  lang: Lang,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const team = await ownerOf(lang);
  if (!team) return [];
  return queryIn<T>(team, text, params);
}

/** These languages grouped by the team that owns each, in their given order. Unowned ones are left out. */
export async function byTeam(langs: readonly Lang[]): Promise<Map<TeamId, Lang[]>> {
  const owners = await freshOwners(langs);
  const grouped = new Map<TeamId, Lang[]>();
  for (const lang of langs) {
    const team = owners.get(lang);
    if (!team) continue;
    const group = grouped.get(team);
    if (group) group.push(lang);
    else grouped.set(team, [lang]);
  }
  return grouped;
}

/**
 * Gives `lang` a team of its own, slugged by its code and holding English's roster, unless a
 * team owns it (adopt_lang). On the caller's client, so it shares the transaction that
 * switches the language on; the caller calls forgetTeams once that commits. adopt_lang acts as
 * every team while it runs, so the caller's transaction need not act as any.
 */
export async function adoptLang(client: ClientBase, lang: string): Promise<void> {
  await client.query(`select adopt_lang($1)`, [lang]);
}

/**
 * Gives every known language with no team to the english team, so no write refuses one: a
 * player's report in it, its activity, the queue's dismissal.
 */
export async function adoptEveryLang(client: ClientBase): Promise<void> {
  for (const lang of CODES) await adoptLang(client, lang);
}

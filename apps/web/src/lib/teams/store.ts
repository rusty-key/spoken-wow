/**
 * Which team owns a language, memoised for a minute. Two pm2 workers cannot share an
 * invalidation, so the short expiry bounds how stale the other worker can be, and a miss is
 * read again so a language the other worker just switched on resolves at once.
 */
import "server-only";

import type { ClientBase, PoolClient, QueryResult, QueryResultRow } from "pg";

import { ALL_TEAMS, query, queryIn, type TeamId, withTeam } from "@/lib/db";
import { BASE_LANG, allLangs, type Lang } from "@/lib/lang";

import { actingTeams, teamIn } from "./acting";
import { listenInServer } from "./listen";

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

/** A team that voices a language, as the memo keeps it. */
export type TeamRef = { id: TeamId; slug: string; name: string };

type Mapping = {
  owners: Map<Lang, TeamId>;
  /** Each language's second teams, by name. */
  seconds: Map<Lang, TeamId[]>;
  /** The languages in `seconds`, built once per read since the overlay asks on every call. */
  second: Set<Lang>;
  teams: Map<TeamId, TeamRef>;
};

let cached: { at: number; mapping: Promise<Mapping> } | null = null;

/** Drops the memo. For a write that changes the mapping or a team's name, and for tests. */
export function forgetTeams(): void {
  cached = null;
}

function mapping(): Promise<Mapping> {
  listenInServer("spoken_team_language", forgetTeams);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.mapping;
  const read = query<{ lang: Lang; teamId: TeamId; privileged: boolean; slug: string; name: string }>(
    `select tl."lang", tl."teamId", tl."privileged", t."slug", t."name"
       from "team_language" tl join "team" t on t."id" = tl."teamId"
      order by t."name", t."slug"`,
  ).then((rows) => {
    const owners = new Map<Lang, TeamId>();
    const seconds = new Map<Lang, TeamId[]>();
    const teams = new Map<TeamId, TeamRef>();
    for (const row of rows) {
      teams.set(row.teamId, { id: row.teamId, slug: row.slug, name: row.name });
      if (row.privileged) owners.set(row.lang, row.teamId);
      else seconds.set(row.lang, [...(seconds.get(row.lang) ?? []), row.teamId]);
    }
    return { owners, seconds, second: new Set(seconds.keys()), teams };
  });
  cached = { at: Date.now(), mapping: read };
  // A failed read must not be served for the next minute.
  read.catch(() => {
    if (cached?.mapping === read) cached = null;
  });
  return read;
}

/** Each language's privileged team. */
export async function teamLangs(): Promise<Map<Lang, TeamId>> {
  return (await mapping()).owners;
}

/** The languages that have a second team besides the privileged one. */
export async function secondTeamLangs(): Promise<Set<Lang>> {
  return (await mapping()).second;
}

/** The teams that voice `lang`, privileged first, then by name. Empty when nobody owns it. */
export async function teamsOf(lang: Lang): Promise<TeamRef[]> {
  const { owners, seconds, teams } = await mappingFor([lang]);
  const privileged = owners.get(lang);
  if (!privileged) return [];
  return [privileged, ...(seconds.get(lang) ?? [])].flatMap((id) => teams.get(id) ?? []);
}

/**
 * The team that owns `lang` for the acting person: their team when `lang` has a second team,
 * else the privileged team. Undefined when nobody owns `lang`. A miss reads again once.
 * Work done for someone outside their request must run in asActor or asTeams, or it lands in
 * the privileged team.
 */
async function ownerOf(lang: Lang): Promise<TeamId | undefined> {
  return (await freshOwners([lang])).get(lang);
}

/** The privileged team of `lang`, the same whoever is acting. A miss reads again once. */
export async function privilegedOf(lang: Lang): Promise<TeamId | undefined> {
  return (await privilegedOwners([lang])).get(lang);
}

/**
 * `team`, else `lang`'s privileged team: the team of somebody in no team of the language, or of
 * an invite that names none.
 */
export async function orPrivileged(team: TeamId | null | undefined, lang: Lang): Promise<TeamId | undefined> {
  return team ?? (await privilegedOf(lang));
}

/** The team `userId` works on `lang` in, else `lang`'s privileged team, as orPrivileged. */
export async function teamOrPrivileged(
  userId: string,
  lang: Lang,
  client?: Pick<ClientBase, "query">,
): Promise<TeamId | undefined> {
  return orPrivileged(await teamIn(userId, lang, client), lang);
}

/** Whether the acting person works on `lang` in a team other than its privileged one. */
export async function actsAsSecondTeam(lang: Lang): Promise<boolean> {
  // The privileged team is read once (a miss reads again), and only a language with a second
  // team reads the acting teams.
  const privileged = await privilegedOf(lang);
  if (!(await secondTeamLangs()).has(lang)) return false;
  const acting = (await actingTeams()).get(lang);
  return Boolean(acting) && acting !== privileged;
}

/**
 * The mapping, read again once (unless the memo is fresh) when any of `langs` has no team. Whole,
 * so a caller reads every field from one read: a handover between two reads could leave the old
 * privileged team beside the new second teams.
 */
async function mappingFor(langs: readonly (Lang | null)[]): Promise<Mapping> {
  const read = await mapping();
  const missing = langs.some((lang) => lang && !read.owners.has(lang));
  if (!missing || !cached || Date.now() - cached.at < MISS_REFRESH_MS) return read;
  forgetTeams();
  return mapping();
}

/** teamLangs, read again once (unless the memo is fresh) when any of `langs` has no team. */
export async function privilegedOwners(langs: readonly (Lang | null)[]): Promise<Map<Lang, TeamId>> {
  return (await mappingFor(langs)).owners;
}

/** Owners of `langs` for the acting person. Reads the session only when a language in `langs` has a second team. */
export async function freshOwners(langs: readonly (Lang | null)[]): Promise<Map<Lang, TeamId>> {
  const owners = await privilegedOwners(langs);
  const second = await secondTeamLangs();
  const shared = langs.filter((lang): lang is Lang => lang !== null && second.has(lang));
  if (!shared.length) return owners;
  const acting = await actingTeams();
  const overlaid = new Map(owners);
  for (const lang of shared) {
    const team = acting.get(lang);
    if (team) overlaid.set(lang, team);
  }
  return overlaid;
}

/**
 * The slot a memo of `lang`'s per-team data lives in: one copy per team, so a language with a
 * second team never serves one team's rows to the other. The value built is still `lang`'s.
 */
export async function scopeKey(lang: Lang): Promise<string> {
  return `${await ownerOrAll(lang)}:${lang}`;
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
 * The team `lang`'s original text is written in: the privileged team, whoever is acting, since
 * the privileged team ships the one text. ALL_TEAMS when nobody owns `lang`.
 */
export async function textTeam(lang: Lang | null): Promise<TeamId | typeof ALL_TEAMS> {
  return (lang && (await privilegedOf(lang))) || ALL_TEAMS;
}

/** `work` in a transaction acting as textTeam(lang), handed the team for the activity it logs. */
export async function withTextTeam<T>(
  lang: Lang | null,
  work: (client: PoolClient, team: TeamId | typeof ALL_TEAMS) => Promise<T>,
): Promise<T> {
  const team = await textTeam(lang);
  return withTeam(team, (client) => work(client, team));
}

/**
 * For what every team keeps a copy of: a language not switched on yet reads English's, which
 * switching it on copies to its own team.
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
 * These languages grouped under every team that voices each: its privileged team and every
 * second team. For work that reaches all of a language's teams, whoever is acting.
 */
export async function everyTeamOf(langs: readonly Lang[]): Promise<Map<TeamId, Lang[]>> {
  const { owners, seconds } = await mappingFor(langs);
  const grouped = new Map<TeamId, Lang[]>();
  for (const lang of langs) {
    const privileged = owners.get(lang);
    if (!privileged) continue;
    for (const team of [privileged, ...(seconds.get(lang) ?? [])]) {
      const group = grouped.get(team);
      if (group) group.push(lang);
      else grouped.set(team, [lang]);
    }
  }
  return grouped;
}

/**
 * On the caller's client, so it shares the transaction that switches the language on; the caller
 * calls forgetTeams once that commits. The transaction need not act as any team.
 */
export async function adoptLang(client: ClientBase, lang: string): Promise<void> {
  await client.query(`select adopt_lang($1)`, [lang]);
}

/**
 * Gives every known language with no team a team of its own, so no write refuses one: a
 * player's report in it, its activity, the queue's dismissal.
 */
export async function adoptEveryLang(client: ClientBase): Promise<void> {
  for (const lang of allLangs()) await adoptLang(client, lang);
}

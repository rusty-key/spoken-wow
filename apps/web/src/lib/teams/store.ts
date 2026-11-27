/**
 * Which teams voice each language, memoised for a minute. Two pm2 workers cannot share an
 * invalidation, so the short expiry bounds how stale the other worker can be, and a miss is
 * read again so a language the other worker just switched on resolves at once.
 *
 * A language's teams are equal: none is its main team (docs/platform/TEAMS.md). English's plain
 * team is the one exception: new teams and unvoiced languages start from it. A call works as the
 * acting person's team in the language; where the language has one team, it is that team,
 * whoever is acting.
 */
import "server-only";

import type { ClientBase, PoolClient, QueryResult, QueryResultRow } from "pg";

import { ALL_TEAMS, query, queryIn, type TeamId, withTeam } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";

import { actingTeams } from "./acting";
import { listenInServer } from "./listen";

export type { TeamId };

/** A language with no team the caller works as: nothing can be written for it. */
export class NoTeamError extends Error {
  constructor(readonly lang: string) {
    super(`${lang} has no team`);
    this.name = "NoTeamError";
  }
}

const TTL_MS = 60_000;
/** How old the memo must be for a miss to read the mapping again: at most once a second. */
const MISS_REFRESH_MS = 1_000;

/** How a language's teams are ordered, over "team_language" tl joined to "team" t: plain packs first, then by name. */
export const TEAM_ORDER = `tl."packName" = 'plain' desc, t."name", t."slug"`;

/** A team that voices a language, as the memo keeps it. */
export type TeamRef = { id: TeamId; slug: string; name: string };

type Mapping = {
  /** Each language's teams: the one with plain packs first, then by name. */
  langs: Map<Lang, TeamId[]>;
  plain: Map<Lang, TeamId>;
  /** The languages with more than one team, built once per read since the overlay asks on every call. */
  shared: Set<Lang>;
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
  const read = query<{ lang: Lang; teamId: TeamId; plain: boolean; slug: string; name: string }>(
    `select tl."lang", tl."teamId", tl."packName" = 'plain' as "plain", t."slug", t."name"
       from "team_language" tl join "team" t on t."id" = tl."teamId"
      order by ${TEAM_ORDER}`,
  ).then((rows) => {
    const langs = new Map<Lang, TeamId[]>();
    const plain = new Map<Lang, TeamId>();
    const teams = new Map<TeamId, TeamRef>();
    for (const row of rows) {
      teams.set(row.teamId, { id: row.teamId, slug: row.slug, name: row.name });
      langs.set(row.lang, [...(langs.get(row.lang) ?? []), row.teamId]);
      if (row.plain) plain.set(row.lang, row.teamId);
    }
    const shared = new Set([...langs].filter(([, ids]) => ids.length > 1).map(([lang]) => lang));
    return { langs, plain, shared, teams };
  });
  cached = { at: Date.now(), mapping: read };
  // A failed read must not be served for the next minute.
  read.catch(() => {
    if (cached?.mapping === read) cached = null;
  });
  return read;
}

/**
 * The mapping, read again once (unless the memo is fresh) when any of `langs` has no team. Whole,
 * so a caller reads every field from one read.
 */
async function mappingFor(langs: readonly (Lang | null)[]): Promise<Mapping> {
  const read = await mapping();
  const missing = langs.some((lang) => lang && !read.langs.has(lang));
  if (!missing || !cached || Date.now() - cached.at < MISS_REFRESH_MS) return read;
  forgetTeams();
  return mapping();
}

/** The languages some team voices. */
export async function teamedLangs(): Promise<Lang[]> {
  return [...(await mapping()).langs.keys()];
}

/** The languages with more than one team, where who is acting decides the team. */
export async function sharedLangs(): Promise<Set<Lang>> {
  return (await mapping()).shared;
}

/**
 * The teams that voice `lang`: the one with plain packs first, then by name. The first is the one
 * a visitor who works in none of them hears. Empty when none does. A miss reads again once.
 */
export async function teamsOf(lang: Lang): Promise<TeamRef[]> {
  const { langs, teams } = await mappingFor([lang]);
  return (langs.get(lang) ?? []).flatMap((id) => teams.get(id) ?? []);
}

/** The team a site owner, or anybody with no choice made, acts in: the first as teamsOf lists them. */
export async function defaultTeamOf(lang: Lang): Promise<TeamRef | undefined> {
  return (await teamsOf(lang))[0];
}

/** The team whose packs in `lang` carry no slug; undefined when no team has them. A miss reads again once. */
export async function plainTeamOf(lang: Lang): Promise<TeamId | undefined> {
  return (await mappingFor([lang])).plain.get(lang);
}

/** `lang`'s team when it has exactly one, whoever is asking. A miss reads again once. */
export async function onlyTeamOf(lang: Lang): Promise<TeamId | undefined> {
  const ids = (await mappingFor([lang])).langs.get(lang);
  return ids?.length === 1 ? ids[0] : undefined;
}

/**
 * The team a call works on `lang` as: the acting person's, and where `lang` has one team, that
 * team. Undefined when no team voices `lang`, or when it has several and the caller works in
 * none of them. Work done for someone outside their request runs in asActor or asTeams.
 */
export async function ownerOf(lang: Lang): Promise<TeamId | undefined> {
  return (await freshOwners([lang])).get(lang);
}

/**
 * The team whose work a reader of `lang` sees: the acting one, else the first as teamsOf lists
 * them, as the Explorer shows an outsider. Never for writes.
 */
export async function readerOf(lang: Lang): Promise<TeamId | undefined> {
  return (await ownerOf(lang)) ?? (await defaultTeamOf(lang))?.id;
}

/** ownerOf for each of `langs`. Reads the session only when one of them has more than one team. */
export async function freshOwners(langs: readonly (Lang | null)[]): Promise<Map<Lang, TeamId>> {
  return overlay(await mappingFor(langs), langs);
}

/**
 * freshOwners with no re-read for a language nobody voices, for callers that pass every
 * language: a newly teamed one may lag until the memo is dropped or expires.
 */
export async function ownersOf(langs: readonly Lang[]): Promise<Map<Lang, TeamId>> {
  return overlay(await mapping(), langs);
}

async function overlay({ langs: teams, shared }: Mapping, langs: readonly (Lang | null)[]): Promise<Map<Lang, TeamId>> {
  const acting = langs.some((lang) => lang !== null && shared.has(lang)) ? await actingTeams() : null;
  const owners = new Map<Lang, TeamId>();
  for (const lang of langs) {
    const ids = lang && teams.get(lang);
    if (!lang || !ids) continue;
    const team = ids.length === 1 ? ids[0] : acting?.get(lang);
    if (team && ids.includes(team)) owners.set(lang, team);
  }
  return owners;
}

/**
 * The team the acting person works on `lang` in, as teamOf picks it, with what decides whether its
 * release builds plain packs (packName) and skips review (official). Null when it has none.
 * A team outside the language reads as `slug`, so its release is never taken for plain packs.
 */
export async function actingTeamRow(
  lang: Lang,
): Promise<{ id: TeamId; slug: string; official: boolean; packName: "plain" | "slug" } | null> {
  const team = await ownerOf(lang);
  if (!team) return null;
  const rows = await query<{ id: TeamId; slug: string; official: boolean; packName: "plain" | "slug" }>(
    `select t."id", t."slug", t."official", coalesce(tl."packName", 'slug') as "packName"
       from "team" t left join "team_language" tl on tl."teamId" = t."id" and tl."lang" = $2
      where t."id" = $1`,
    [team, lang],
  );
  return rows[0] ?? null;
}

/**
 * The slot a memo of `lang`'s per-team data lives in: one copy per team it is read as (readerOf,
 * as readAs reads), so a language with several teams never serves one team's rows to another.
 * The value built is still `lang`'s.
 */
export async function scopeKey(lang: Lang): Promise<string> {
  return `${(await readerOf(lang)) ?? ALL_TEAMS}:${lang}`;
}

/** `shared`: the language has other teams besides this one. */
export type ActingTeamName = { name: string; shared: boolean };

/**
 * No re-read for a language nobody voices, since a site admin passes every language: a new team's
 * name may lag by a minute.
 */
export async function actingTeamNames(langs: readonly Lang[]): Promise<Partial<Record<Lang, ActingTeamName>>> {
  const read = await mapping();
  const acting = await overlay(read, langs);
  return Object.fromEntries(
    langs.flatMap((lang) => {
      const team = acting.get(lang);
      const name = team && read.teams.get(team)?.name;
      return name ? [[lang, { name, shared: read.shared.has(lang) }]] : [];
    }),
  );
}

/** The team the caller works on `lang` as; throws NoTeamError when there is none. */
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
 * `work` in a transaction for `lang`'s original text, which every team shares and no team owns:
 * as the acting team, else ALL_TEAMS. `team` is the activity's: the writer's team, else none.
 */
export async function withTextTeam<T>(
  lang: Lang | null,
  work: (client: PoolClient, team: TeamId | null) => Promise<T>,
): Promise<T> {
  const team = await ownerOrAll(lang);
  return withTeam(team, (client) => work(client, team === ALL_TEAMS ? null : team));
}

/**
 * For what every team keeps a copy of: a language not switched on yet reads English's, which
 * switching it on copies to its own team. English's plain team, since a reader outside English's
 * teams has no acting one there.
 */
export async function teamOrEnglish(lang: Lang): Promise<TeamId> {
  const team = (await ownerOf(lang)) ?? (await plainTeamOf(BASE_LANG));
  if (!team) throw new NoTeamError(BASE_LANG);
  return team;
}

/** How a per-team write is made, so the row takes its "teamId" from the column default. */
export async function asTeamOf<T>(lang: Lang, work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTeam(await teamOf(lang), work);
}

/** One statement as the team the caller works on `lang` as, its whole result kept: writes check rowCount. */
export async function queryAs<T extends QueryResultRow = QueryResultRow>(
  lang: Lang,
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return asTeamOf(lang, (client) => client.query<T>(text, params));
}

/**
 * Without a team to work as, no rows rather than a throw: an admin's look at a language never
 * switched on still renders an empty explorer.
 */
export async function readAs<T extends QueryResultRow = QueryResultRow>(
  lang: Lang,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const team = await readerOf(lang);
  if (!team) return [];
  return queryIn<T>(team, text, params);
}

/** readAs for the acting team only: somebody outside every team of `lang` reads nothing. */
export async function readAsActing<T extends QueryResultRow = QueryResultRow>(
  lang: Lang,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const team = await ownerOf(lang);
  if (!team) return [];
  return queryIn<T>(team, text, params);
}

/** Each language under its team, in their given order; a pair with no team is left out. */
export function groupByTeam<L extends string>(pairs: Iterable<readonly [TeamId | undefined, L]>): Map<TeamId, L[]> {
  const grouped = new Map<TeamId, L[]>();
  for (const [team, lang] of pairs) {
    if (!team) continue;
    const group = grouped.get(team);
    if (group) group.push(lang);
    else grouped.set(team, [lang]);
  }
  return grouped;
}

/** These languages grouped by the team the caller works as in each, in their given order. Others are left out. */
export async function byTeam(langs: readonly Lang[]): Promise<Map<TeamId, Lang[]>> {
  const owners = await freshOwners(langs);
  return groupByTeam(langs.map((lang) => [owners.get(lang), lang] as const));
}

/** These languages grouped under every team that voices each. For work that reaches all of a language's teams, whoever is acting. */
export async function everyTeamOf(langs: readonly Lang[]): Promise<Map<TeamId, Lang[]>> {
  const { langs: teams } = await mappingFor(langs);
  return groupByTeam(langs.flatMap((lang) => (teams.get(lang) ?? []).map((team) => [team, lang] as const)));
}

/**
 * A team for `lang`, which has no plain team: slugged by its code, with English's roster and plain
 * packs. On the caller's client, in its transaction; the caller calls forgetTeams once that
 * commits. The transaction need not act as any team.
 */
export async function foundLangTeam(client: ClientBase, lang: string): Promise<TeamId> {
  const { rows } = await client.query<{ id: TeamId }>(`select found_lang_team($1) as "id"`, [lang]);
  return rows[0].id;
}

/** Gives English a team when it has none, as on an empty database. No other language gets one for being known. */
export async function adoptEnglish(client: ClientBase): Promise<void> {
  await client.query(`select adopt_lang($1)`, [BASE_LANG]);
}

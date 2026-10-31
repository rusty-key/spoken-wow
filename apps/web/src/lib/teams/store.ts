/**
 * Which team owns a language: `team_language`, and the only module that knows its columns.
 *
 * Every per-team table is keyed by team, and callers know a language, so this is the bridge.
 * The privileged team is the one whose members' work in the language is what ships; a
 * language has exactly one.
 *
 * Memoised for a minute in-process. The mapping changes only when a language is added or
 * handed over, which is rare, and two pm2 workers cannot share an invalidation, so a short
 * expiry is what bounds how stale the other worker can be. A language the memo has no team
 * for is looked up again before it is taken to have none (ownerOf), so one switched on by
 * the other worker resolves at once rather than a minute later.
 */
import "server-only";

import type { ClientBase, PoolClient, QueryResult, QueryResultRow } from "pg";

import { ALL_TEAMS, query, queryIn, type TeamId, withTeam } from "@/lib/db";
import { BASE_LANG, CODES, type Lang } from "@/lib/lang";

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

/** Every language that has a privileged team, with that team. */
export function teamLangs(): Promise<Map<Lang, TeamId>> {
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

/**
 * The privileged team of `lang`, or undefined for a language nobody owns. A miss reads the
 * mapping again once, unless the memo is fresh: the other pm2 worker may have switched the
 * language on since this one read it, and the minute's expiry is too long to wait for that.
 */
async function ownerOf(lang: Lang): Promise<TeamId | undefined> {
  return (await freshOwners([lang])).get(lang);
}

/**
 * teamLangs, read again once when any of `langs` has no team in it, on the terms ownerOf
 * gives: for the callers that resolve many languages from one map, which would otherwise
 * drop or mis-stamp a language the other worker has just switched on.
 */
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
 * The team that owns `lang`, or ALL_TEAMS for a site-wide (null) or unowned language: for the
 * reads and writes that must still work there rather than refuse, where ALL_TEAMS leaves the
 * row's "teamId" null.
 */
export async function ownerOrAll(lang: Lang | null): Promise<TeamId | typeof ALL_TEAMS> {
  return (lang && (await ownerOf(lang))) || ALL_TEAMS;
}

/**
 * The team that owns `lang`, or the english team for a language nobody owns: where that
 * language would land when switched on (languages/store.ts setEnabled, migration 0087). For
 * what every team keeps a copy of -- the roster, the base settings -- so that a language not
 * yet given a team reads English's, as every language did before teams.
 */
export async function teamOrEnglish(lang: Lang): Promise<TeamId> {
  return (await ownerOf(lang)) ?? teamOf(BASE_LANG);
}

/**
 * `work` in a transaction as the team that owns `lang`: how a write to a per-team table is
 * made, so the row takes its "teamId" from the column default. Throws NoTeamError for a
 * language nobody owns, since its work would have nowhere to land.
 */
export async function asTeamOf<T>(lang: Lang, work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTeam(await teamOf(lang), work);
}

/**
 * One statement as the team that owns `lang`, its whole result kept (rowCount is what several
 * writes are checked by). The write twin of readAs: throws NoTeamError rather than answering
 * nothing, as asTeamOf does.
 */
export async function queryAs<T extends QueryResultRow = QueryResultRow>(
  lang: Lang,
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return asTeamOf(lang, (client) => client.query<T>(text, params));
}

/**
 * One read of a per-team table, as the team that owns `lang`.
 *
 * A language nobody owns answers no rows rather than throwing. Every language with takes was
 * given a team when teams arrived, so there is nothing of its to read, and an admin's early
 * look at a language never switched on keeps rendering an empty explorer as it does today.
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

/**
 * The team a transaction acts as when the rows it writes are shared -- quest text, names, a
 * contribution -- and only its activity row is a team's: the language's owner, or ALL_TEAMS
 * for a language nobody owns and for none, whose acts are logged with no team
 * (activity/store.ts), which only ALL_TEAMS may write.
 */
export async function loggerOf(lang: Lang | null): Promise<TeamId | typeof ALL_TEAMS> {
  return (lang && (await ownerOf(lang))) || ALL_TEAMS;
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
 * Gives `lang` to the english team unless some team already owns it: where every unmaintained
 * language lives, and handing it to a team of its own is a later, deliberate act. On the
 * caller's client, so it can share the transaction that switches the language on. The caller
 * forgets the memo (forgetTeams) once that commits.
 */
export async function adoptLang(client: ClientBase, lang: string): Promise<void> {
  await client.query(
    `insert into "team_language" ("teamId", "lang", "privileged")
     select "id", $1, true from "team" where "slug" = 'english'
        and team_of_lang($1) is null
     on conflict do nothing`,
    [lang],
  );
}

/**
 * Gives every language the site knows (CODES) that no team owns to the english team, so that
 * no language is left where a write refuses it: a player's report in it, its activity, the
 * queue's dismissal. Run once per server process when the queue starts (generation/boot.ts)
 * and when a language is switched on; the caller forgets the memo once that commits.
 *
 * Parking unowned languages on the english team is a phase-1 stopgap. Eventually a language
 * no team owns goes to a separate bucket, not English (docs/platform/TEAMS.md).
 */
export async function adoptEveryLang(client: ClientBase): Promise<void> {
  for (const lang of CODES) await adoptLang(client, lang);
}

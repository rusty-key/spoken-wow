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

import type { PoolClient, QueryResultRow } from "pg";

import { query, queryIn, withTeam } from "@/lib/db";
import type { Lang } from "@/lib/lang";

export type TeamId = string;

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
  const team = (await teamLangs()).get(lang);
  if (team || !cached || Date.now() - cached.at < MISS_REFRESH_MS) return team;
  forgetTeams();
  return (await teamLangs()).get(lang);
}

export async function teamOf(lang: Lang): Promise<TeamId> {
  const team = await ownerOf(lang);
  if (!team) throw new NoTeamError(lang);
  return team;
}

export async function allTeams(): Promise<TeamId[]> {
  const rows = await query<{ id: TeamId }>(`select "id" from "team" order by "createdAt", "id"`);
  return rows.map((row) => row.id);
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

/** These languages grouped by the team that owns each, in their given order. Unowned ones are left out. */
export async function byTeam(langs: readonly Lang[]): Promise<Map<TeamId, Lang[]>> {
  const owners = await teamLangs();
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

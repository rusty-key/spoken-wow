/**
 * Which team owns a language: `team_language`, and the only module that knows its columns.
 *
 * Every per-team table is keyed by team, and callers know a language, so this is the bridge.
 * The privileged team is the one whose members' work in the language is what ships; a
 * language has exactly one.
 *
 * Memoised for a minute in-process. The mapping changes only when a language is added or
 * handed over, which is rare, and two pm2 workers cannot share an invalidation, so a short
 * expiry is what bounds how stale the other worker can be.
 */
import "server-only";

import { query } from "@/lib/db";
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

export async function teamOf(lang: Lang): Promise<TeamId> {
  const team = (await teamLangs()).get(lang);
  if (!team) throw new NoTeamError(lang);
  return team;
}

export async function allTeams(): Promise<TeamId[]> {
  const rows = await query<{ id: TeamId }>(`select "id" from "team" order by "createdAt", "id"`);
  return rows.map((row) => row.id);
}

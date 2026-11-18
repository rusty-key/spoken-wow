/**
 * The teams that voice a language, and the one a visitor listens to. Viewing a team other than
 * the acting one is read-only: its live takes and the overrides they speak are public, the rest
 * of its rows are not (TEAMS.md, "Who sees what").
 */
import "server-only";

import { ALL_TEAMS, query } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";

import { ownerOrAll, secondTeamLangs, teamsOf, type TeamId } from "./store";

export type TeamChoice = { id: TeamId; slug: string; name: string; privileged: boolean };

/** The teams a visitor may pick between: none where the language has one team, so no picker shows. */
export async function teamsVoicing(lang: Lang): Promise<TeamChoice[]> {
  if (!(await secondTeamLangs()).has(lang)) return [];
  return (await teamsOf(lang)).map((team, index) => ({ ...team, privileged: index === 0 }));
}

/**
 * The team whose takes play: the one `slug` names, else the acting team, else the privileged
 * team. Null for a slug naming no team of `lang`, or for a language nobody owns. `own` is
 * whether the visitor acts as it, and so may change its work.
 */
export async function viewedTeam(
  lang: Lang,
  slug: string | null,
): Promise<{ team: TeamId; slug: string; name: string; own: boolean } | null> {
  const acting = await ownerOrAll(lang);
  if (acting === ALL_TEAMS) return null;
  const teams = slug === null ? await teamsOf(lang) : await teamsVoicing(lang);
  const found = teams.find((team) => (slug === null ? team.id === acting : team.slug === slug));
  return found ? { team: found.id, slug: found.slug, name: found.name, own: found.id === acting } : null;
}

/** The override text `team`'s live takes speak, by line key: a quest line's file, else its line id. */
export async function teamLiveOverrides(team: TeamId, source: Source, lang: Lang): Promise<Map<string, string>> {
  const rows = await query<{ key: string; text: string }>(`select "key", "text" from team_live_overrides($1, $2, $3)`, [
    team, lang, source,
  ]);
  return new Map(rows.map((row) => [row.key, row.text]));
}

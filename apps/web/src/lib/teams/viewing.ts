/**
 * The teams that voice a language, and the one a visitor listens to. Viewing a team other than
 * the acting one is read-only: its live takes and the overrides they speak are public, the rest
 * of its rows are not (TEAMS.md, "Who sees what").
 */
import "server-only";

import { ALL_TEAMS, query } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";
import { serveTake } from "@/lib/takes/serve";
import { livePath, teamLivePath } from "@/lib/takes/store";
import type { LineOverride } from "@/lib/quests/override";
import type { OverrideView } from "@/lib/text-overrides/types";

import { asTeam } from "./acting";
import { ownerOrAll, secondTeamLangs, teamsOf, type TeamId } from "./store";
import type { TeamView } from "./view";

export type TeamChoice = { id: TeamId; slug: string; name: string; privileged: boolean };

/** The teams a visitor may pick between: none where the language has one team, so no picker shows. */
export async function teamsVoicing(lang: Lang): Promise<TeamChoice[]> {
  if (!(await secondTeamLangs()).has(lang)) return [];
  return (await teamsOf(lang)).map((team, index) => ({ ...team, privileged: index === 0 }));
}

export type ViewedTeam = { team: TeamId; slug: string; name: string; own: boolean };

/**
 * The team whose takes play: the one `slug` names, else the acting team, else the privileged
 * team. Null for a slug naming no team of `lang`, or for a language nobody owns. `own` is
 * whether the view is the visitor's acting team, the one their work goes to.
 */
export async function viewedTeam(lang: Lang, slug: string | null): Promise<ViewedTeam | null> {
  const acting = await ownerOrAll(lang);
  if (acting === ALL_TEAMS) return null;
  const found = (await teamsOf(lang)).find((team) => (slug === null ? team.id === acting : team.slug === slug));
  return found ? { team: found.id, slug: found.slug, name: found.name, own: found.id === acting } : null;
}

/**
 * What an explorer page needs for its picker: the teams to pick between, the one whose takes
 * play and the slug of the default one, which a link names by leaving `team` out. A slug
 * naming no team of `lang` falls back to the default. In a language with one team, or none,
 * there is nothing to pick and no view (`viewed` null: the visitor's own), and nothing is read
 * beyond the memo.
 */
export async function teamView(
  lang: Lang,
  slug: string | null,
): Promise<TeamView> {
  const teams = await teamsVoicing(lang);
  if (teams.length === 0) return { teams, viewed: null, home: null };
  const home = await viewedTeam(lang, null);
  const named = slug && slug !== home?.slug ? await viewedTeam(lang, slug) : null;
  return { teams, viewed: named ?? home, home: home?.slug ?? null };
}

/**
 * `work` as the viewed team when it is another team's, else as the visitor: for what that
 * team's own rows shape, such as the quests voice filter its roster names.
 */
export function asViewed<T>(lang: Lang, viewed: ViewedTeam | null, work: () => Promise<T>): Promise<T> {
  return viewed && !viewed.own ? asTeam(lang, viewed.team, work) : work();
}

/** The override text `team`'s live takes speak, by line key: a quest line's file, else its line id. */
export async function teamLiveOverrides(team: TeamId, source: Source, lang: Lang): Promise<Map<string, string>> {
  const rows = await query<{ key: string; text: string }>(`select "key", "text" from team_live_overrides($1, $2, $3)`, [
    team, lang, source,
  ]);
  return new Map(rows.map((row) => [row.key, row.text]));
}

/**
 * Entries as somebody who does not work in the language sees their team's: an override only
 * where a live take speaks it, as another team's view shows one, and never who wrote it. An
 * override still in progress is the team's unfinished work, so the line shows as `base` has it.
 */
export async function asPublished<E extends { id: string; override?: OverrideView }>(
  entries: E[],
  base: () => Promise<E[]>,
  source: Exclude<Source, "quests">,
  lang: Lang,
): Promise<E[]> {
  if (!entries.some((entry) => entry.override)) return entries;
  const team = await ownerOrAll(lang);
  const live = team === ALL_TEAMS ? new Map<string, string>() : await teamLiveOverrides(team, source, lang);
  const original = new Map((await base()).map((entry) => [entry.id, entry]));
  return entries.map((entry) => {
    if (!entry.override) return entry;
    if (live.get(entry.id) === entry.override.text) {
      return { ...entry, override: { ...entry.override, updatedAt: "", updatedBy: null } };
    }
    return original.get(entry.id) ?? { ...entry, override: undefined };
  });
}

/** Quest overrides as asPublished leaves them: those a live take speaks, without their author. */
export async function publishedOverrides(lang: Lang, overrides: Map<string, LineOverride>): Promise<Map<string, LineOverride>> {
  if (overrides.size === 0) return overrides;
  const team = await ownerOrAll(lang);
  const live = team === ALL_TEAMS ? new Map<string, string>() : await teamLiveOverrides(team, "quests", lang);
  return new Map(
    [...overrides]
      .filter(([file, override]) => live.get(file) === override.text)
      .map(([file, override]) => [file, { ...override, updatedAt: "", updatedBy: null }]),
  );
}

/** The answer to a `team` parameter naming no team of the language. */
export function unknownTeam(slug: string, lang: Lang): Response {
  return Response.json({ error: `no team ${slug} voices ${lang}` }, { status: 404 });
}

/**
 * Filters a view of another team cannot answer, dropped rather than left to match nothing: who
 * made a take, recordings, reports, dirt and staleness are that team's private rows.
 */
export function viewOnly<
  F extends { model?: string; author?: string; recorded?: unknown; reports?: unknown; dirty?: boolean; state?: string },
>(filters: F): F {
  return {
    ...filters,
    model: undefined,
    author: undefined,
    recorded: undefined,
    reports: undefined,
    dirty: undefined,
    state: filters.state === "stale" ? undefined : filters.state,
  };
}

/**
 * Lines as another team is heard: a line it has a live take of shows the override that take
 * speaks, and reads as current, since the view has none of the rows that would say otherwise.
 * `spoken` and `hash` stay the original's; the take is given the line's hash to match.
 */
export function asHeard<
  E extends { id: string; hash: string | null; override?: OverrideView },
  T extends { textHash: string },
  C extends { takes: Map<string, T> },
>(entries: E[], context: C, overrides: Map<string, string>): { entries: E[]; context: C } {
  const takes = new Map(context.takes);
  const heard = entries.map((entry) => {
    const take = takes.get(entry.id);
    if (take && entry.hash !== null) takes.set(entry.id, { ...take, textHash: entry.hash });
    const text = overrides.get(entry.id);
    return text === undefined ? entry : { ...entry, override: { text, drifted: false, updatedAt: "", updatedBy: null } };
  });
  return { entries: heard, context: { ...context, takes } };
}

/**
 * The team a request's `team` parameter names, when it is not the acting one: null without one
 * (an empty one counts as none), and then no lookup is made; null for the acting team's own slug;
 * a 404 for a slug naming no team of `lang`.
 */
export async function viewedOther(params: URLSearchParams, lang: Lang): Promise<TeamId | null | Response> {
  const slug = params.get("team") || null;
  if (slug === null) return null;
  const viewed = await viewedTeam(lang, slug);
  if (!viewed) return unknownTeam(slug, lang);
  return viewed.own ? null : viewed.team;
}

/**
 * The live take of `file` the request's `team` parameter names: the acting team's without one,
 * as always; another team's only where it has a live take, through team_live_takes.
 */
export async function serveViewed(request: Request, source: Source, file: string, lang: Lang): Promise<Response> {
  const other = await viewedOther(new URL(request.url).searchParams, lang);
  if (other instanceof Response) return other;
  if (other !== null) return serveTake(request, await teamLivePath(other, source, file, lang), { immutable: false, lang });
  const perVisitor = (await secondTeamLangs()).has(lang);
  return serveTake(request, await livePath(source, file, lang), { immutable: false, lang, perVisitor });
}

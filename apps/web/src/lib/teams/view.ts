/**
 * The browser's half of viewing another team: the explorers send `team` only while the view is
 * not the visitor's own, so a language with one team, and the default view, ask exactly what
 * they always asked.
 */
// Type-only, so viewing.ts's server-only guard never reaches the bundle.
import type { TeamChoice, ViewedTeam } from "./viewing";

/** What an explorer page hands its explorer: the teams to pick between, the one playing, the default's slug. */
export type TeamView = { teams: TeamChoice[]; viewed: ViewedTeam | null; home: string | null };

/** No view (one team in the language, or none) is the visitor's own. */
export function isOwn(viewed: ViewedTeam | null): boolean {
  return viewed === null || viewed.own;
}

/**
 * An explorer's React key: a new view starts from a fresh explorer. The router keeps the old
 * one's state across the switch, so its rows, selection and late refreshes would otherwise
 * carry one team's lines into the other's view.
 */
export function viewKey({ viewed }: TeamView): string {
  return viewed === null ? "own" : `${viewed.team}:${viewed.own}`;
}

/** The slug a request names while the view is another team's, else null: a string, so it serves as a hook dependency. */
export function otherTeam(viewed: ViewedTeam | null): string | null {
  return viewed === null || viewed.own ? null : viewed.slug;
}

/** `url` asking for `team`'s takes, from otherTeam; unchanged for the visitor's own view. */
export function forTeam(url: string, team: string | null): string {
  return team === null ? url : `${url}${url.includes("?") ? "&" : "?"}team=${encodeURIComponent(team)}`;
}

/**
 * `next` with the `team` of `current`. The page resolved its view from that parameter, so a
 * filter write that dropped it would leave the rows of one team under the URL of another.
 */
export function keepTeam(next: URLSearchParams, current: URLSearchParams): URLSearchParams {
  const team = current.get("team");
  if (team && !next.has("team")) next.set("team", team);
  return next;
}

/**
 * The address with `slug` picked, every filter kept; the default team is named by leaving `team`
 * out. The page number goes: the other team's matches may not reach it.
 */
export function pickedHref(pathname: string, current: URLSearchParams, slug: string, home: string | null): string {
  const next = new URLSearchParams(current.toString());
  next.delete("page");
  if (slug === home) next.delete("team");
  else next.set("team", slug);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

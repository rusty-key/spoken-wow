/**
 * A site owner's choice of team in each language with several teams, kept in a cookie so every
 * route and page acts in it through actingTeams, with no parameter threaded through the site's
 * calls. TEAMS.md lets a site owner act inside any team without being a member; for anyone
 * else the cookie is ignored, so editing it moves nobody out of their team.
 */
import "server-only";

import { cookies } from "next/headers";

import type { Lang } from "@/lib/lang";

import { sharedLangs, teamsOf, type TeamId } from "./store";

export const ACTING_COOKIE = "spoken_team";

const YEAR_S = 365 * 24 * 60 * 60;

/** The cookie's `{ [lang]: slug }`; anything else, a forged or stale value included, is no choice. */
export function parseChoice(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

/** The Set-Cookie value keeping `choice`; an empty choice expires the cookie. */
export function actingCookie(choice: Record<string, string>): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const empty = Object.keys(choice).length === 0;
  const value = empty ? "" : encodeURIComponent(JSON.stringify(choice));
  return `${ACTING_COOKIE}=${value}; Path=/; Max-Age=${empty ? 0 : YEAR_S}; HttpOnly; SameSite=Lax${secure}`;
}

/** The request's choice, unchecked: for the route that changes it and for showing it. */
export async function currentChoice(): Promise<Record<string, string>> {
  return parseChoice((await cookies()).get(ACTING_COOKIE)?.value);
}

/**
 * The cookie's choices that name a team voicing their language, from the memo. The caller checks
 * that the session's person is a site owner. Without a language of several teams the cookie is
 * not read.
 */
export async function chosenTeams(): Promise<Map<string, TeamId>> {
  const shared = await sharedLangs();
  const chosen = new Map<string, TeamId>();
  if (shared.size === 0) return chosen;
  for (const [key, slug] of Object.entries(await currentChoice())) {
    const lang = key as Lang;
    if (!shared.has(lang)) continue;
    const team = (await teamsOf(lang)).find((candidate) => candidate.slug === slug);
    if (team) chosen.set(lang, team.id);
  }
  return chosen;
}

/**
 * The teams a site owner acts in: in each language of several teams, the cookie's choice, else
 * their own team there, else the first as the picker lists them, so a site owner always has a
 * team to work in.
 */
export async function siteOwnerTeams(member: ReadonlyMap<string, TeamId>): Promise<Map<string, TeamId>> {
  const shared = await sharedLangs();
  if (shared.size === 0) return new Map(member);
  const unchosen = new Map<string, TeamId>();
  for (const lang of shared) {
    const first = (await teamsOf(lang))[0];
    if (first) unchosen.set(lang, first.id);
  }
  return new Map([...unchosen, ...member, ...(await chosenTeams())]);
}

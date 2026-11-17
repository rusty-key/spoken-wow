/**
 * language_grant holds `text`, stored as `edit` because a rollback's release reads that value
 * there; team_member holds every other capability, the team's `edit` included.
 *
 * Read once per render (the grants are cached on the user id), because a page asks "may
 * this person do that here" more than once and the answer does not change inside it.
 */
import "server-only";

import type { ClientBase } from "pg";
import { cache } from "react";

import { recordActivities, recordActivity } from "@/lib/activity/store";
import { ALL_TEAMS, db, query, withTeam } from "@/lib/db";
import { teamIn } from "@/lib/teams/acting";
import { deleteMember, insertMembers } from "@/lib/teams/members";
import { ownerOrAll, privilegedOwners, secondTeamLangs, teamOf, type TeamId } from "@/lib/teams/store";
import { isLang, langName, type Lang } from "@/lib/lang";
import { textByTeam } from "@/lib/languages/store";
import { canGrant, isCapability, type Capability, type Grant, type Viewer } from "@/lib/permissions";

/**
 * On the caller's client when given. A team's row is privileged only when the team is the
 * language's cached privileged owner, so a second team the memo does not know yet fails closed.
 */
export async function grantsOf(userId: string, client?: Pick<ClientBase, "query">): Promise<Grant[]> {
  const { rows } = await (client ?? db()).query<{ lang: string; capability: string; teamId: TeamId | null }>(
    `select "lang", 'text' as "capability", null::uuid as "teamId" from "language_grant" where "userId" = $1
     union all
     select "lang", "capability", "teamId" from "team_member" where "userId" = $1
     order by "lang", "capability"`,
    [userId],
  );
  const owners = await privilegedOwners(rows.filter((row) => row.teamId !== null).map((row) => row.lang as Lang));
  const grants: Grant[] = [];
  for (const { lang, capability, teamId } of rows) {
    if (!isCapability(capability)) continue;
    const privileged = teamId === null || owners.get(lang as Lang) === teamId;
    grants.push(privileged ? { lang, capability } : { lang, capability, privileged: false });
  }
  return grants;
}

/** Keyed on the user id, a string, which is what lets React's cache find it again. */
const cachedGrants = cache(grantsOf);

/** Who a session belongs to, with their grants. Null for nobody signed in. */
export async function viewerOf(
  session: { user: { id: string; role?: string | null } } | null,
): Promise<Viewer | null> {
  if (!session) return null;
  return { role: session.user.role, grants: await cachedGrants(session.user.id) };
}

/**
 * Somebody by id, as `viewerOf` sees a session: null for no such user and for one with a live
 * ban, who may not hand anything out (the test `findLiveToken` applies to a token's owner).
 */
export async function viewerById(userId: string): Promise<Viewer | null> {
  const rows = await query<{ role: string | null }>(
    `select "role" from "user"
      where "id" = $1 and not (coalesce("banned", false) and ("banExpires" is null or "banExpires" > now()))`,
    [userId],
  );
  return rows[0] ? viewerOf({ user: { id: userId, role: rows[0].role } }) : null;
}

export type GrantRow = {
  userId: string;
  email: string;
  name: string | null;
  lang: string;
  capability: Capability;
  grantedAt: string;
  /** The team the grant is in; null for `text`, which is the language's, not a team's. */
  teamSlug: string | null;
};

const GRANTS = `(
  select "userId", "lang", 'text' as "capability", "grantedAt", null::uuid as "teamId" from "language_grant"
  union all
  select "userId", "lang", "capability", "grantedAt", "teamId" from "team_member"
)`;

/**
 * Who holds a grant in `lang`. In a language with a second team, the acting team's members and
 * the `text` holders, who belong to no team; else everyone.
 */
export async function viewersIn(lang: Lang): Promise<Map<string, Viewer>> {
  const shared = (await secondTeamLangs()).has(lang);
  const team = shared ? await ownerOrAll(lang) : ALL_TEAMS;
  const rows = await query<{ userId: string; role: string | null; capability: Capability }>(
    `select g."userId", u."role", g."capability"
       from ${GRANTS} g join "user" u on u."id" = g."userId"
      where g."lang" = $1 and ($2 = '*' or g."teamId" is null or g."teamId"::text = $2)`,
    [lang, team],
  );
  const viewers = new Map<string, Viewer>();
  for (const { userId, role, capability } of rows) {
    const grants = viewers.get(userId)?.grants ?? [];
    viewers.set(userId, { role, grants: [...grants, { lang, capability }] });
  }
  return viewers;
}

/** Every grant in the given languages, or in all of them, with who holds it. */
export async function listGrants(langs?: string[]): Promise<GrantRow[]> {
  return selectGrants(`($1::text[] is null or g."lang" = any($1::text[]))`, [langs ?? null]);
}

/** The team rows of each language in `teams` that are its team's, and the `text` rows of `textLangs`. */
export async function listTeamGrants(
  teams: ReadonlyMap<string, TeamId>,
  textLangs: readonly string[],
): Promise<GrantRow[]> {
  return selectGrants(
    `(g."teamId" is null and g."lang" = any($1::text[]))
     or (g."lang", g."teamId") in (select * from unnest($2::text[], $3::uuid[]))`,
    [textLangs, [...teams.keys()], [...teams.values()]],
  );
}

async function selectGrants(where: string, params: unknown[]): Promise<GrantRow[]> {
  const rows = await query<Omit<GrantRow, "grantedAt"> & { grantedAt: Date }>(
    `select g."userId", u."email", u."name", g."lang", g."capability", g."grantedAt", t."slug" as "teamSlug"
       from ${GRANTS} g join "user" u on u."id" = g."userId"
       left join "team" t on t."id" = g."teamId"
      where ${where}
      order by g."lang", u."email", g."capability"`,
    params,
  );
  return rows.map((row) => ({ ...row, grantedAt: row.grantedAt.toISOString() }));
}

/** The refusal of a second team in `lang`: "`already` on <language> in `team`; one person ...". */
export function oneTeamPerLanguage(already: string, lang: string, team: string): string {
  return `${already} on ${langName(lang)} in ${team}; one person works in one team per language.`;
}

/** Granting somebody a team capability in a language they already work on in another team. */
export class OtherTeamError extends Error {
  constructor(readonly lang: Lang) {
    super(oneTeamPerLanguage("That person already works", lang, "another team"));
    this.name = "OtherTeamError";
  }
}

/** Postgres' exclusion_violation, which team_member raises at commit for a second team in one language. */
export function isOtherTeam(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23P01";
}

/**
 * Several capabilities in one language at once, all or none. Recorded in the activity log
 * only for the rows that are new: granting what somebody already holds changes nothing, and
 * the log would otherwise say it was handed out twice.
 *
 * Team capabilities go to `options.team`, else the team the granter works on the language in,
 * else the language's owner. Somebody who works on it in another team is refused with
 * OtherTeamError. `options.within` runs first on the same transaction.
 */
export async function addGrants(
  userId: string,
  lang: string,
  capabilities: readonly Capability[],
  grantedBy: string,
  options: { team?: TeamId; within?: (client: ClientBase) => Promise<void> } = {},
): Promise<void> {
  if (!isLang(lang)) throw new Error(`${lang} is not a language this site knows`);
  const members = capabilities.filter((capability) => capability !== "text");
  // A language with one team has only teamOf's to grant into, and the commit's 23P01 still
  // backstops a membership elsewhere.
  const teams = members.length > 0 && (await secondTeamLangs()).has(lang);
  const team = members.length
    ? (options.team ?? (teams ? await teamIn(grantedBy, lang) : null) ?? (await teamOf(lang)))
    : await ownerOrAll(lang);
  try {
    await withTeam(team, async (client) => {
      // First, so that a throw from it grants nothing.
      await options.within?.(client);
      if (teams) {
        const theirs = await teamIn(userId, lang, client);
        if (theirs && theirs !== team) throw new OtherTeamError(lang);
      }
      const added = await grantOn(client, team, userId, lang, capabilities, grantedBy);
      await recordActivities(
        added.map((capability) => ({
          kind: "grant.added",
          lang,
          subject: userId,
          actorId: grantedBy,
          detail: { capability },
          // Not ALL_TEAMS, which would file the row unowned: no team falls back to the language's.
          team: team === ALL_TEAMS ? undefined : team,
        })),
        client,
      );
    });
  } catch (error) {
    if (isOtherTeam(error)) throw new OtherTeamError(lang);
    throw error;
  }
}

/** The first of `capabilities` that `viewer` may not grant in `lang`, or null when they may grant them all. */
export async function refusedGrant(
  viewer: Viewer | null,
  capabilities: readonly Capability[],
  lang: Lang,
): Promise<Capability | null> {
  // canGrant reads whose text it is only for `text`.
  const byTeam = capabilities.includes("text") && (await textByTeam(lang));
  return capabilities.find((capability) => !canGrant(viewer, capability, lang, byTeam)) ?? null;
}

/**
 * The capabilities among `capabilities` that `userId` did not hold yet, granted on the caller's
 * client; members go to `team`. Checks nothing and logs nothing: a language created in the same
 * transaction is not in the registry yet.
 */
export async function grantOn(
  client: ClientBase,
  team: TeamId,
  userId: string,
  lang: string,
  capabilities: readonly Capability[],
  grantedBy: string,
): Promise<Capability[]> {
  const members = capabilities.filter((capability) => capability !== "text");
  const added: Capability[] = [];
  if (members.length < capabilities.length) {
    const { rowCount } = await client.query(
      `insert into "language_grant" ("userId", "lang", "capability", "grantedBy")
       values ($1, $2, 'edit', $3)
       on conflict ("userId", "lang", "capability") do nothing`,
      [userId, lang, grantedBy],
    );
    if (rowCount) added.push("text");
  }
  if (members.length) added.push(...(await insertMembers(client, team, userId, lang, members, grantedBy)));
  return added;
}

/**
 * `removedBy` is for the activity log, which is the only trace a removal leaves: the row
 * itself is gone. Nothing is recorded when there was no such grant to remove.
 */
export async function removeGrant(
  userId: string,
  lang: Lang,
  capability: Capability,
  removedBy: string,
  team?: TeamId,
): Promise<void> {
  const removed = await deleteGrant(userId, lang, capability, team);
  if (!removed) return;
  await recordActivity({
    kind: "grant.removed",
    lang,
    subject: userId,
    actorId: removedBy,
    detail: { capability },
    team: removed.team,
  });
}

/**
 * With `team`, a team capability is removed only from that team. Null when there was nothing to
 * remove; else the team the removed row was in, none for `text`.
 */
async function deleteGrant(
  userId: string,
  lang: Lang,
  capability: Capability,
  team?: TeamId,
): Promise<{ team?: TeamId } | null> {
  if (capability === "text") {
    const rows = await query(
      `delete from "language_grant" where "userId" = $1 and "lang" = $2 returning 1`,
      [userId, lang],
    );
    return rows.length > 0 ? {} : null;
  }
  const removedFrom = await deleteMember(userId, lang, capability, team);
  return removedFrom ? { team: removedFrom } : null;
}

/** Somebody to grant to, found by email: a language admin cannot list the users. */
export async function userByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const rows = await query<{ id: string; email: string }>(
    `select "id", "email" from "user" where lower("email") = lower($1)`,
    [email.trim()],
  );
  return rows[0] ?? null;
}

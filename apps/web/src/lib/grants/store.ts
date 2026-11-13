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
import { query, withTeam } from "@/lib/db";
import { deleteMember, insertMembers } from "@/lib/teams/members";
import { ownerOrAll, teamOf, type TeamId } from "@/lib/teams/store";
import { isLang, type Lang } from "@/lib/lang";
import { textByTeam } from "@/lib/languages/store";
import { canGrant, isCapability, type Capability, type Grant, type Viewer } from "@/lib/permissions";

export async function grantsOf(userId: string): Promise<Grant[]> {
  const rows = await query<{ lang: string; capability: string }>(
    `select "lang", 'text' as "capability" from "language_grant" where "userId" = $1
     union all
     select "lang", "capability" from "team_member" where "userId" = $1
     order by "lang", "capability"`,
    [userId],
  );
  return rows.filter((row) => isCapability(row.capability)) as Grant[];
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
};

const GRANTS = `(
  select "userId", "lang", 'text' as "capability", "grantedAt" from "language_grant"
  union all
  select "userId", "lang", "capability", "grantedAt" from "team_member"
)`;

export async function viewersIn(lang: Lang): Promise<Map<string, Viewer>> {
  const rows = await query<{ userId: string; role: string | null; capability: Capability }>(
    `select g."userId", u."role", g."capability"
       from ${GRANTS} g join "user" u on u."id" = g."userId"
      where g."lang" = $1`,
    [lang],
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
  const rows = await query<Omit<GrantRow, "grantedAt"> & { grantedAt: Date }>(
    `select g."userId", u."email", u."name", g."lang", g."capability", g."grantedAt"
       from ${GRANTS} g join "user" u on u."id" = g."userId"
      where $1::text[] is null or g."lang" = any($1::text[])
      order by g."lang", u."email", g."capability"`,
    [langs ?? null],
  );
  return rows.map((row) => ({ ...row, grantedAt: row.grantedAt.toISOString() }));
}

/**
 * Several capabilities in one language at once, all or none. Recorded in the activity log
 * only for the rows that are new: granting what somebody already holds changes nothing, and
 * the log would otherwise say it was handed out twice.
 */
export async function addGrants(
  userId: string,
  lang: string,
  capabilities: readonly Capability[],
  grantedBy: string,
  within?: (client: ClientBase) => Promise<void>,
): Promise<void> {
  if (!isLang(lang)) throw new Error(`${lang} is not a language this site knows`);
  const members = capabilities.filter((capability) => capability !== "text");
  const team = members.length ? await teamOf(lang) : await ownerOrAll(lang);
  await withTeam(team, async (client) => {
    // First, so that a throw from it grants nothing.
    await within?.(client);
    const added = await grantOn(client, team, userId, lang, capabilities, grantedBy);
    await recordActivities(
      added.map((capability) => ({
        kind: "grant.added",
        lang,
        subject: userId,
        actorId: grantedBy,
        detail: { capability },
      })),
      client,
    );
  });
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
): Promise<void> {
  if (!(await deleteGrant(userId, lang, capability))) return;
  await recordActivity({
    kind: "grant.removed",
    lang,
    subject: userId,
    actorId: removedBy,
    detail: { capability },
  });
}

async function deleteGrant(userId: string, lang: Lang, capability: Capability): Promise<boolean> {
  if (capability === "text") {
    const rows = await query(
      `delete from "language_grant" where "userId" = $1 and "lang" = $2 returning 1`,
      [userId, lang],
    );
    return rows.length > 0;
  }
  return deleteMember(userId, lang, capability);
}

/** Somebody to grant to, found by email: a language admin cannot list the users. */
export async function userByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const rows = await query<{ id: string; email: string }>(
    `select "id", "email" from "user" where lower("email") = lower($1)`,
    [email.trim()],
  );
  return rows[0] ?? null;
}

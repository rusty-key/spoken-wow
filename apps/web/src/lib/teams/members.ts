/**
 * team_member: the only module that names its columns. A member's audio capabilities, per
 * language of the team; `edit` stays in language_grant.
 */
import type { ClientBase } from "pg";

import type { Capability } from "@/lib/permissions";

/** The capabilities that were handed out; the ones already held are left out. */
export async function insertMembers(
  client: ClientBase,
  team: string,
  userId: string,
  lang: string,
  capabilities: readonly Capability[],
  grantedBy: string,
): Promise<Capability[]> {
  const { rows } = await client.query<{ capability: Capability }>(
    `insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedBy")
     select $1, $2, $3, capability, $5 from unnest($4::text[]) as capability
     on conflict ("teamId", "userId", "lang", "capability") do nothing
     returning "capability"`,
    [team, userId, lang, capabilities, grantedBy],
  );
  return rows.map((row) => row.capability);
}

export async function deleteMember(
  client: ClientBase,
  team: string,
  userId: string,
  lang: string,
  capability: Capability,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `delete from "team_member"
      where "teamId" = $1 and "userId" = $2 and "lang" = $3 and "capability" = $4`,
    [team, userId, lang, capability],
  );
  return (rowCount ?? 0) > 0;
}

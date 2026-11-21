/** The only module that names team_member's columns. `text` is in language_grant. */
import type { ClientBase } from "pg";

import { query } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import type { Capability } from "@/lib/permissions";

export async function membersOf(
  client: ClientBase,
  team: string,
): Promise<{ email: string; lang: Lang; capability: Capability }[]> {
  const { rows } = await client.query<{ email: string; lang: Lang; capability: Capability }>(
    `select u."email", m."lang", m."capability" from "team_member" m join "user" u on u."id" = m."userId"
      where m."teamId" = $1 order by u."email", m."lang", m."capability"`,
    [team],
  );
  return rows;
}

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

/**
 * Only `team`'s row when given; else whatever team the row is filed under, as grantsOf reads it:
 * a grant it shows must be removable. The team of the row deleted, or null when there was none.
 */
export async function deleteMember(
  userId: string,
  lang: string,
  capability: Capability,
  team?: string,
): Promise<string | null> {
  const rows = await query<{ teamId: string }>(
    `delete from "team_member"
      where "userId" = $1 and "lang" = $2 and "capability" = $3 and ($4::uuid is null or "teamId" = $4)
      returning "teamId"`,
    [userId, lang, capability, team ?? null],
  );
  return rows[0]?.teamId ?? null;
}

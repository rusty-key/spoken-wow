/** The only module that names team_member's columns. `text` is in language_grant. */
import type { ClientBase } from "pg";

import { query } from "@/lib/db";
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

/** Whatever team the row is filed under, as grantsOf reads it: a grant it shows must be removable. */
export async function deleteMember(userId: string, lang: string, capability: Capability): Promise<boolean> {
  const rows = await query(
    `delete from "team_member" where "userId" = $1 and "lang" = $2 and "capability" = $3 returning 1`,
    [userId, lang, capability],
  );
  return rows.length > 0;
}

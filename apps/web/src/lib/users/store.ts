/**
 * The global admin's user list. The admin plugin's listUsers searches one field at a time;
 * somebody looking for a person types part of a name or of an address without saying which.
 *
 * No access check here: the Users page only calls this for a global admin.
 */
import "server-only";

import { query } from "@/lib/db";

import type { UserSort, UserSortColumn } from "./sort";

export type ListedUser = {
  id: string;
  name: string | null;
  email: string;
  role: string | null;
  createdAt: string;
};

/**
 * What each column orders by, written out so no caller can name SQL. Languages is the
 * languages somebody holds a grant in, alphabetically joined, so a column sorted on it groups
 * people by language; an admin holds every language and sorts before anybody.
 */
const ORDER: Record<UserSortColumn, string> = {
  name: `u."name"`,
  email: `u."email"`,
  joined: `u."createdAt"`,
  languages: `case when u."role" = 'admin' then '' else g."langs" end`,
};

/** A page of users whose name or email contains `q` (any case). Empty values last either way. */
export async function listUsers({
  q,
  sort,
  limit,
  offset,
}: {
  q: string;
  sort: UserSort;
  limit: number;
  offset: number;
}): Promise<{ users: ListedUser[]; total: number }> {
  // Wildcards in what was typed are matched as themselves.
  const pattern = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const rows = await query<Omit<ListedUser, "createdAt"> & { createdAt: Date; total: string }>(
    `select u."id", u."name", u."email", u."role", u."createdAt", count(*) over () as "total"
       from "user" u
       left join lateral (
         select string_agg(distinct "lang", ',' order by "lang") as "langs"
           from (
             select "lang" from "language_grant" where "userId" = u."id"
             union all
             select "lang" from "team_member" where "userId" = u."id"
           ) held
       ) g on true
      where $1::text is null or u."name" ilike $1 or u."email" ilike $1
      order by ${ORDER[sort.column]} ${sort.direction === "desc" ? "desc" : "asc"} nulls last,
               u."createdAt", u."id"
      limit $2 offset $3`,
    [pattern, limit, offset],
  );
  // Past the last page there are no rows to carry the count, and nothing to page back from.
  const total = rows[0] ? Number(rows[0].total) : 0;
  return {
    users: rows.map(({ total: _, createdAt, ...user }) => ({ ...user, createdAt: createdAt.toISOString() })),
    total,
  };
}

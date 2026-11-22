/** The site's own address, for links in emails, and who to tell about something waiting for a site admin. */
import "server-only";

import type { PoolClient } from "pg";

import { db } from "@/lib/db";

export const SITE = (process.env.BETTER_AUTH_URL ?? "https://spoken.quest").replace(/\/$/, "");

/** Every site admin's address; on the caller's client when given. */
export async function adminEmails(client?: Pick<PoolClient, "query">): Promise<string[]> {
  const { rows } = await (client ?? db()).query<{ email: string }>(`select "email" from "user" where "role" = 'admin'`);
  return rows.map((row) => row.email);
}

/**
 * For tests that write a language's quest text: what a test changed in `lang`, taken back after
 * it. The rows it wrote go, and the rows it retired are live again, so a database holding the
 * language's real text keeps it.
 */
import { afterEach, beforeEach } from "vitest";

import { db, query } from "@/lib/db";

const TABLES = ["quest_line", "entity_name"] as const;

export function keepLanguage(lang: string): void {
  let before: { table: (typeof TABLES)[number]; highest: number; live: number[] }[] = [];

  beforeEach(async () => {
    before = await Promise.all(
      TABLES.map(async (table) => {
        const [{ highest }] = await query<{ highest: number }>(
          `select coalesce(max("id"), 0)::int as "highest" from "${table}"`,
        );
        const live = await query<{ id: number }>(`select "id" from "${table}" where "lang" = $1 and "isCurrent"`, [lang]);
        return { table, highest, live: live.map((row) => row.id) };
      }),
    );
  });

  afterEach(async () => {
    for (const { table, highest, live } of before) {
      await db().query(`delete from "${table}" where "lang" = $1 and "id" > $2`, [lang, highest]);
      await db().query(`update "${table}" set "isCurrent" = true where "id" = any($1::int[]) and not "isCurrent"`, [live]);
    }
  });
}

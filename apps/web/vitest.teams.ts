/**
 * Give every language a team on the test database, as production's have: the built-in ones and
 * the rows the migrations seed (a team's language, such as Polish). A test database starts from
 * English alone, so every per-team write in another language would refuse.
 */
import type { TestProject } from "vitest/node";
import { Client } from "pg";

import { allLangs } from "./src/lib/lang";

export default async function setup(project: TestProject) {
  const url = process.env.DATABASE_URL ?? project.config.env?.DATABASE_URL;
  if (!url) return;
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const { rows } = await client.query<{ code: string }>(`select "code" from "language"`);
    for (const lang of new Set([...allLangs(), ...rows.map((row) => row.code)])) {
      await client.query(`select found_lang_team($1) where team_of_lang($1) is null`, [lang]);
    }
  } catch {
    // No database, or not migrated: the suites that need one say so themselves.
  } finally {
    await client.end().catch(() => {});
  }
}

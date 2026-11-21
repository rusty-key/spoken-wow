/**
 * Give every language a team on the test database, as production's have: the built-in ones and
 * the rows the migrations seed (a team's language, such as Polish). A test database starts from
 * English alone, so every per-team write in another language would refuse.
 */
import type { TestProject } from "vitest/node";
import { Client } from "pg";

export default async function setup(project: TestProject) {
  const url = process.env.DATABASE_URL ?? project.config.env?.DATABASE_URL;
  if (!url) return;
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    // The migrations seed a row for every built-in language.
    await client.query(`select found_lang_team("code") from "language" where team_of_lang("code") is null`);
  } catch {
    // No database, or not migrated: the suites that need one say so themselves.
  } finally {
    await client.end().catch(() => {});
  }
}

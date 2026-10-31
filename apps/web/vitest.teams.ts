/**
 * Give every language a team on the test database, as production has.
 *
 * Every per-team write resolves its language's team and refuses a language with none. In
 * production the server gives every language one when it starts (adoptEveryLang); a test
 * database starts from English alone, so the suites that write German or Korean takes would
 * otherwise all refuse. Seeded the same way.
 */
import type { TestProject } from "vitest/node";
import { Client } from "pg";

import { adoptEveryLang } from "./src/lib/teams/store";

export default async function setup(project: TestProject) {
  const url = process.env.DATABASE_URL ?? project.config.env?.DATABASE_URL;
  if (!url) return;
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    await adoptEveryLang(client);
  } catch {
    // No database, or not migrated: the suites that need one say so themselves.
  } finally {
    await client.end().catch(() => {});
  }
}

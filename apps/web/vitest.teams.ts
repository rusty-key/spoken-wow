/**
 * Give every language a team on the test database, as the server does in production at start.
 * A test database starts from English alone, so every per-team write in another language would refuse.
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

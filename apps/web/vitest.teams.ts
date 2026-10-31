/**
 * Give every language a team on the test database, as production has.
 *
 * Every per-team write resolves its language's team and refuses a language with none. In
 * production each language with any work was given one when teams arrived (migration 0087),
 * and switching one on gives it the english team; a test database starts from English alone,
 * so the suites that write German or Korean takes would otherwise all refuse. Seeded the way
 * setEnabled seeds a new language (adoptLang).
 */
import type { TestProject } from "vitest/node";
import { Client } from "pg";

import { CODES } from "./src/lib/lang";
import { adoptLang } from "./src/lib/teams/store";

export default async function setup(project: TestProject) {
  const url = process.env.DATABASE_URL ?? project.config.env?.DATABASE_URL;
  if (!url) return;
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    for (const lang of CODES) await adoptLang(client, lang);
  } catch {
    // No database, or not migrated: the suites that need one say so themselves.
  } finally {
    await client.end().catch(() => {});
  }
}

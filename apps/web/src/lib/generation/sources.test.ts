/**
 * Every source the app can write must be a source the schema accepts.
 *
 * Against a real Postgres, because the thing being tested lives only there. Adding a
 * section means widening a check constraint on every table that carries one, and the cost
 * of missing one is invisible until the one code path that writes that table runs: readables
 * shipped with `regeneration_batch` and `report` still refusing it, so single-page
 * regeneration worked and the first "Regenerate these" click returned a 500.
 *
 * This asks the database which tables constrain a source column and checks them all, rather
 * than listing the ones somebody remembered. A fifth table added later is covered the day it
 * exists.
 *
 * Needs DATABASE_URL and migrations applied:
 *   DATABASE_URL=... bash deploy/web/bin/migrate.sh apps/web
 */
import { afterAll, expect, it } from "vitest";

const { closeDb, query } = await import("@/lib/db");

import { SOURCES } from "@/lib/sections";

afterAll(async () => {
  await closeDb();
});

it("every source check constraint accepts every section", async () => {
  const constraints = await query<{ table: string; name: string; def: string }>(
    `select conrelid::regclass::text as "table", conname as "name",
            pg_get_constraintdef(oid) as "def"
       from pg_constraint
      where contype = 'c' and pg_get_constraintdef(oid) like '%''quests''%'
        -- A community pack's section is where the Manager installs it, not a voice source.
        and conrelid <> 'community_pack'::regclass
      order by 1`,
  );

  // A guard on the guard: if this finds nothing, the query is wrong rather than the schema
  // being permissive, and an empty loop below would pass in silence.
  expect(constraints.length).toBeGreaterThanOrEqual(4);

  const missing = constraints.flatMap((row) =>
    SOURCES.filter((source) => !row.def.includes(`'${source}'`)).map(
      (source) => `${row.table}.${row.name} rejects '${source}'`,
    ),
  );

  expect(missing).toEqual([]);
});

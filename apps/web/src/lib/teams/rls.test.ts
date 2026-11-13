/**
 * Row-level security, as the app role meets it (migration 0090).
 *
 * A superuser bypasses every policy, FORCE or not, so these mean something only when the pool
 * acts as `spoken_app` -- DATABASE_ROLE, which vitest.config.ts defaults to it. Run as anything
 * that bypasses, they fail on the first assertion rather than pass for the wrong reason.
 *
 * Needs DATABASE_URL and migrations through 0090 applied.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { ALL_TEAMS, closeDb, db, withTeam } = await import("@/lib/db");
const { liveTakes } = await import("@/lib/takes/store");
const { listActivity, recordActivity } = await import("@/lib/activity/store");
const { forgetTeams, teamOf } = await import("./store");

/** A second team in deDE beside its privileged one. */
let other: string;
let file: string;

beforeAll(async () => {
  const { rows } = await db().query<{ bypasses: boolean }>(
    `select "rolsuper" or "rolbypassrls" as "bypasses" from "pg_roles" where "rolname" = current_user`,
  );
  if (rows[0]?.bypasses) {
    throw new Error("rls.test.ts must run as a role row-level security binds: set DATABASE_ROLE=spoken_app");
  }
});

beforeEach(async () => {
  const slug = `test-rls-${randomUUID().slice(0, 8)}`;
  const { rows } = await db().query<{ id: string }>(
    `insert into "team" ("slug", "name") values ($1, $1) returning "id"`,
    [slug],
  );
  other = rows[0].id;
  await db().query(`insert into "team_language" ("teamId", "lang", "privileged") values ($1, 'deDE', false)`, [other]);
  forgetTeams();
  file = `gossip/${randomUUID()}rls.mp3`;
  await withTeam(other, (client) =>
    client.query(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes")
       values ('quests', 'deDE', $1, 'g:rls', 1, true, 'generated', 1)`,
      [file],
    ),
  );
});

afterEach(async () => {
  await withTeam(ALL_TEAMS, async (client) => {
    await client.query(`delete from "take" where "teamId" = $1`, [other]);
    await client.query(`delete from "activity" where "subject" like 'rls-%'`);
  });
  await db().query(`delete from "team" where "id" = $1`, [other]);
  forgetTeams();
});

afterAll(closeDb);

describe("row-level security", () => {
  it("binds every table with a team, so a new one cannot be left open", async () => {
    // team_language and team_member are read before a team is set: one to find the request's
    // team, the other for a viewer's grants, which span teams.
    const { rows } = await db().query<{ table: string; enabled: boolean; forced: boolean; policies: number }>(
      `select c."relname" as "table", c."relrowsecurity" as "enabled", c."relforcerowsecurity" as "forced",
              (select count(*)::int from "pg_policies" p
                where p."schemaname" = 'public' and p."tablename" = c."relname") as "policies"
         from "pg_class" c
         join "pg_namespace" n on n."oid" = c."relnamespace"
         join "pg_attribute" a on a."attrelid" = c."oid" and a."attname" = 'teamId' and not a."attisdropped"
        where n."nspname" = 'public' and c."relkind" in ('r', 'p') and c."relname" not in ('team_language', 'team_member')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !row.enabled || !row.forced || row.policies === 0)).toEqual([]);
  });

  it("keeps another team's take out of the privileged team's live takes", async () => {
    const live = await liveTakes("quests", "deDE");
    expect(live.some((take) => take.file === file)).toBe(false);

    const own = await withTeam(other, (client) =>
      client.query(`select 1 from "take" where "file" = $1`, [file]),
    );
    expect(own.rowCount).toBe(1);
  });

  it("shows no per-team row to a query outside withTeam", async () => {
    const { rows } = await db().query<{ count: number }>(`select count(*)::int as "count" from "take"`);
    expect(rows[0].count).toBe(0);
  });

  it("refuses a row written for another team", async () => {
    const privileged = await teamOf("deDE");
    await expect(
      withTeam(privileged, (client) =>
        client.query(
          `insert into "take" ("source", "lang", "file", "lineId", "version", "origin", "bytes", "teamId")
           values ('quests', 'deDE', $1, 'g:rls', 2, 'generated', 1, $2)`,
          [file, other],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // Nor can it touch one: the update finds nothing to change.
    const { rowCount } = await withTeam(privileged, (client) =>
      client.query(`update "take" set "bytes" = 2 where "file" = $1`, [file]),
    );
    expect(rowCount).toBe(0);
  });

  it("lets every team read a site-wide event, and only ALL_TEAMS write or remove one", async () => {
    const subject = `rls-${randomUUID()}`;
    await recordActivity({ kind: "ignore.set", lang: null, actorId: null, subject, detail: {} });

    const { rows } = await listActivity({ lang: "deDE" });
    expect(rows.some((row) => row.subject === subject)).toBe(true);

    const team = await teamOf("deDE");
    await expect(
      withTeam(team, (client) =>
        client.query(`insert into "activity" ("kind", "subject", "detail", "teamId") values ('ignore.set', $1, '{}', null)`, [
          `${subject}-team`,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    const removed = await withTeam(team, (client) =>
      client.query(`delete from "activity" where "subject" = $1`, [subject]),
    );
    expect(removed.rowCount).toBe(0);
  });
});

/**
 * withTeam against a real Postgres: the setting must live and die with its transaction, or a
 * pooled connection carries one team's identity into the next request.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it } from "vitest";

import { ALL_TEAMS, closeDb, db, POOL_MAX, queryIn, withTeam } from "@/lib/db";

const SETTING = `select current_setting('spoken.team', true) as t`;
const SLUG = `test-withteam-${Math.random().toString(36).slice(2, 8)}`;

afterAll(async () => {
  await db().query(`delete from "team" where "slug" = $1`, [SLUG]);
  await closeDb();
});

describe("withTeam", () => {
  it("sets spoken.team for the transaction", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const seen = await withTeam(id, async (c) => (await c.query(SETTING)).rows[0].t);
    expect(seen).toBe(id);
    expect(await withTeam(ALL_TEAMS, async (c) => (await c.query(SETTING)).rows[0].t)).toBe("*");
  });

  it("queryIn returns rows under the team", async () => {
    expect(await queryIn<{ t: string }>("abc", SETTING)).toEqual([{ t: "abc" }]);
  });

  it("rolls back and rethrows when work throws", async () => {
    await expect(
      withTeam(ALL_TEAMS, async (c) => {
        await c.query(`insert into "team" ("slug", "name") values ($1, 'x')`, [SLUG]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const { rowCount } = await db().query(`select 1 from "team" where "slug" = $1`, [SLUG]);
    expect(rowCount).toBe(0);
  });

  it("leaves no team on reused connections", async () => {
    const n = POOL_MAX + 10;
    for (let i = 0; i < n; i++) await withTeam(`team-${i}`, async () => {});
    for (let i = 0; i < n; i++) {
      const { rows } = await db().query(SETTING);
      expect([null, ""]).toContain(rows[0].t);
    }
  });
});

/** Needs DATABASE_URL and migrations applied. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, ownTeam, testUser } from "@/lib/teams/testing";

import { dashboard } from "./dashboard";

describe("dashboard", () => {
  let de: Awaited<ReturnType<typeof ownTeam>>;

  beforeAll(async () => {
    de = await ownTeam("deDE");
  });

  afterEach(async () => {
    await asSystem.query(`delete from "report" where "body" like 'dashboard-test%'`);
    await asSystem.query(`delete from "activity" where "subject" like 'dashboard-test%'`);
  });

  afterAll(async () => {
    await de.restore();
    await closeDb();
  });

  it("counts a language's open reports by category, and none of another's", async () => {
    await asSystem.query(
      `insert into "report" ("source", "category", "body", "lang", "status", "teamId") values
         ('quests', 'pronunciation', 'dashboard-test 1', 'deDE', 'open', $1),
         ('quests', 'pronunciation', 'dashboard-test 2', 'deDE', 'open', $1),
         ('quests', 'wrong_voice', 'dashboard-test 3', 'deDE', 'fixed', $1)`,
      [de.team],
    );
    const before = await dashboard("deDE", ["audio", "text"]);
    expect(before.reports.pronunciation).toBeGreaterThanOrEqual(2);
    expect(before.reports.wrong_voice).toBe(0);
    expect(before.release).toHaveLength(4);
  });

  it("counts this week's takes from the activity log", async () => {
    const start = (await dashboard("deDE", ["audio"])).week.takes;
    await asSystem.query(
      `insert into "activity" ("lang", "kind", "source", "subject", "detail", "teamId")
       values ('deDE', 'take.generated', 'quests', 'dashboard-test', '{"version":1}', $1)`,
      [de.team],
    );
    expect((await dashboard("deDE", ["audio"])).week.takes).toBe(start + 1);
  });

  it("counts only the report queues the viewer works, as /reports shows them", async () => {
    await asSystem.query(
      `insert into "report" ("source", "category", "body", "lang", "status", "queue", "teamId") values
         ('quests', 'wrong_text', 'dashboard-test text', 'deDE', 'open', 'text', $1),
         ('quests', 'wrong_text', 'dashboard-test audio', 'deDE', 'open', 'audio', $1)`,
      [de.team],
    );
    const both = (await dashboard("deDE", ["audio", "text"])).reports.wrong_text;
    expect((await dashboard("deDE", ["audio"])).reports.wrong_text).toBe(both - 1);
    expect((await dashboard("deDE", [])).reports.wrong_text).toBe(0);
  });

  it("counts somebody who holds admin as able to do what admin includes", async () => {
    const user = await testUser("dashboard-test-admin");
    try {
      await asSystem.query(
        `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, 'deDE', 'admin')`,
        [de.team, user.id],
      );
      const { holders } = await dashboard("deDE", ["audio"]);
      for (const capability of ["edit", "regenerate", "admin"] as const) {
        expect(holders[capability].map((h) => h.id)).toContain(user.id);
      }
      expect(holders.text.map((h) => h.id)).not.toContain(user.id);
    } finally {
      await asSystem.query(`delete from "team_member" where "userId" = $1`, [user.id]);
      await user.cleanup();
    }
  });
});

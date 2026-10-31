/** Needs DATABASE_URL and migrations applied. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { recordActivity } from "@/lib/activity/store";
import { closeDb, db, inTransaction } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";
import { setEnabled } from "@/lib/languages/store";
import { createReport } from "@/lib/reports/store";

import { adoptEveryLang, byTeam, forgetTeams, NoTeamError, readAs, teamLangs, teamOf } from "./store";

const USER = `test-teams-${Math.random().toString(36).slice(2, 10)}`;
// A code nobody has a team for once cleanup has run; vitest.teams.ts gives it one again after.
const NEW_LANG = "deDE";
const IP = `${USER}-ip`;

async function englishTeam(): Promise<string> {
  const { rows } = await asSystem.query(`select "id" from "team" where "slug" = 'english'`);
  return rows[0].id;
}

async function cleanup() {
  await asSystem.query(`delete from "team_language" where "lang" = $1`, [NEW_LANG]);
  await asSystem.query(`delete from "language" where "code" = $1`, [NEW_LANG]);
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [USER]);
  await asSystem.query(`delete from "report" where "ip" = $1`, [IP]);
  forgetTeams();
}

beforeAll(async () => {
  await cleanup();
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, false)`,
    [USER, `${USER}@example.invalid`],
  );
});

beforeEach(() => forgetTeams());

afterAll(async () => {
  await cleanup();
  // Back on the english team, where vitest.teams.ts put it, for the suites that write German.
  await asSystem.query(
    `insert into "team_language" ("teamId", "lang") select "id", $1 from "team" where "slug" = 'english'`,
    [NEW_LANG],
  );
  forgetTeams();
  await asSystem.query(`delete from "user" where "id" = $1`, [USER]);
  await closeDb();
});

describe("teamOf", () => {
  it("resolves English to the english team", async () => {
    expect(await teamOf("enUS")).toBe(await englishTeam());
  });

  it("rejects for a language with no team", async () => {
    await expect(teamOf(NEW_LANG)).rejects.toBeInstanceOf(NoTeamError);
  });

  it("gives a newly enabled language to the english team", async () => {
    await setEnabled(NEW_LANG, true, USER);
    expect(await teamOf(NEW_LANG)).toBe(await englishTeam());
    expect((await teamLangs()).get(NEW_LANG)).toBe(await englishTeam());
    const { rows } = await db().query(`select "id" from "team"`);
    expect(rows.map((row) => row.id)).toContain(await englishTeam());
  });

  it("leaves the team alone when a language is toggled again", async () => {
    await setEnabled(NEW_LANG, true, USER);
    await setEnabled(NEW_LANG, false, USER);
    const { rows } = await asSystem.query(
      `select count(*)::int as n from "team_language" where "lang" = $1`,
      [NEW_LANG],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("adoptEveryLang", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  const report = () =>
    createReport({
      source: "quests", lang: NEW_LANG, lineId: null, target: "quest/1/accept", category: "other",
      body: "test", userId: null, name: null, email: null, ip: IP,
    });

  it("gives a language with no team one, so a report in it can be filed", async () => {
    await expect(report()).rejects.toBeInstanceOf(NoTeamError);
    await inTransaction(adoptEveryLang);
    forgetTeams();
    await report();
    expect(await teamOf(NEW_LANG)).toBe(await englishTeam());
  });
});

describe("a language switched on by the other worker", () => {
  // As the other pm2 worker's setEnabled does: the row, and no forgetTeams in this process.
  const enableElsewhere = () =>
    db().query(
      `insert into "team_language" ("teamId", "lang") select "id", $1 from "team" where "slug" = 'english'`,
      [NEW_LANG],
    );

  beforeEach(async () => {
    await cleanup();
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await cleanup();
  });

  it("is found by teamOf without waiting for the memo to expire", async () => {
    await expect(teamOf(NEW_LANG)).rejects.toBeInstanceOf(NoTeamError);
    await enableElsewhere();
    vi.advanceTimersByTime(2_000);
    expect(await teamOf(NEW_LANG)).toBe(await englishTeam());
  });

  it("is read by readAs without waiting for the memo to expire", async () => {
    expect(await readAs(NEW_LANG, `select 1 as "one"`)).toEqual([]);
    await enableElsewhere();
    vi.advanceTimersByTime(2_000);
    expect(await readAs(NEW_LANG, `select 1 as "one"`)).toEqual([{ one: 1 }]);
  });

  it("is grouped by byTeam without waiting for the memo to expire", async () => {
    expect(await byTeam([NEW_LANG])).toEqual(new Map());
    await enableElsewhere();
    vi.advanceTimersByTime(2_000);
    expect(await byTeam([NEW_LANG])).toEqual(new Map([[await englishTeam(), [NEW_LANG]]]));
  });

  it("has its activity stamped with its team without waiting for the memo to expire", async () => {
    await teamLangs();
    await enableElsewhere();
    vi.advanceTimersByTime(2_000);
    await recordActivity({ kind: "language.toggled", lang: NEW_LANG, actorId: USER, detail: { enabled: true } });
    const { rows } = await asSystem.query(`select "teamId" from "activity" where "actorId" = $1`, [USER]);
    expect(rows).toEqual([{ teamId: await englishTeam() }]);
  });

  it("is not looked up again on a miss against a memo under a second old", async () => {
    await expect(teamOf(NEW_LANG)).rejects.toBeInstanceOf(NoTeamError);
    await enableElsewhere();
    await expect(teamOf(NEW_LANG)).rejects.toBeInstanceOf(NoTeamError);
  });
});

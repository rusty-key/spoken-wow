/**
 * Team resolution against a real Postgres: the language -> privileged team mapping lives in
 * the schema, and the new-language rule lives in setEnabled's SQL.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { setEnabled } from "@/lib/languages/store";

import { allTeams, forgetTeams, NoTeamError, teamLangs, teamOf } from "./store";

const USER = `test-teams-${Math.random().toString(36).slice(2, 10)}`;
// A code nobody has a team for once cleanup has run; vitest.teams.ts gives it one again after.
const NEW_LANG = "deDE";

async function englishTeam(): Promise<string> {
  const { rows } = await db().query(`select "id" from "team" where "slug" = 'english'`);
  return rows[0].id;
}

async function cleanup() {
  await db().query(`delete from "team_language" where "lang" = $1`, [NEW_LANG]);
  await db().query(`delete from "language" where "code" = $1`, [NEW_LANG]);
  await db().query(`delete from "activity" where "actorId" = $1`, [USER]);
  forgetTeams();
}

beforeAll(async () => {
  await cleanup();
  await db().query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, false)`,
    [USER, `${USER}@example.invalid`],
  );
});

beforeEach(() => forgetTeams());

afterAll(async () => {
  await cleanup();
  // Back on the english team, where vitest.teams.ts put it, for the suites that write German.
  await db().query(
    `insert into "team_language" ("teamId", "lang") select "id", $1 from "team" where "slug" = 'english'`,
    [NEW_LANG],
  );
  forgetTeams();
  await db().query(`delete from "user" where "id" = $1`, [USER]);
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
    expect(await allTeams()).toContain(await englishTeam());
  });

  it("leaves the team alone when a language is toggled again", async () => {
    await setEnabled(NEW_LANG, true, USER);
    await setEnabled(NEW_LANG, false, USER);
    const { rows } = await db().query(
      `select count(*)::int as n from "team_language" where "lang" = $1`,
      [NEW_LANG],
    );
    expect(rows[0].n).toBe(1);
  });
});

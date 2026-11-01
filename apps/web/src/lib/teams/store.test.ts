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

/** The team NEW_LANG had before this file took it away, given back at the end. */
let was: string | undefined;

/**
 * The team adoption made for NEW_LANG. The one it had still holds the slug "dede", so adoption
 * makes "dede-2": a language adopted never joins a team that happens to bear its code.
 */
async function ownTeamId(): Promise<string> {
  const { rows } = await asSystem.query(
    `select t."id" from "team" t where t."id" = team_of_lang($1) and t."slug" ~ $2 and t."id" is distinct from $3`,
    [NEW_LANG, `^${NEW_LANG.toLowerCase()}-[0-9]+$`, was ?? null],
  );
  return rows[0]?.id;
}

async function cleanup() {
  await asSystem.query(`delete from "team_language" where "lang" = $1`, [NEW_LANG]);
  await asSystem.query(`delete from "language" where "code" = $1`, [NEW_LANG]);
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [USER]);
  await asSystem.query(`delete from "report" where "ip" = $1`, [IP]);
  // The teams adoption made here, with the roster it copied to each.
  const { rows: made } = await asSystem.query<{ id: string }>(
    `select "id" from "team" where "slug" ~ $1 and "id" is distinct from $2`,
    [`^${NEW_LANG.toLowerCase()}-[0-9]+$`, was ?? null],
  );
  for (const { id } of made) {
    for (const table of ["team_member", "voice_assignment", "voice", "generation_setting", "queue_dismissal"]) {
      await asSystem.query(`delete from "${table}" where "teamId" = $1`, [id]);
    }
    await asSystem.query(`delete from "team" where "id" = $1`, [id]);
  }
  forgetTeams();
}

beforeAll(async () => {
  const { rows } = await asSystem.query<{ team: string | null }>(`select team_of_lang($1) as "team"`, [NEW_LANG]);
  was = rows[0].team ?? undefined;
  await cleanup();
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, false)`,
    [USER, `${USER}@example.invalid`],
  );
});

beforeEach(() => forgetTeams());

afterAll(async () => {
  await cleanup();
  // Back on its own team, where migration 0091 put it, for the suites that write German.
  if (was) await asSystem.query(`insert into "team_language" ("teamId", "lang") values ($1, $2)`, [was, NEW_LANG]);
  else await asSystem.query(`select adopt_lang($1)`, [NEW_LANG]);
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

  it("gives a newly enabled language a team of its own", async () => {
    await setEnabled(NEW_LANG, true, USER);
    expect(await teamOf(NEW_LANG)).toBe(await ownTeamId());
    expect((await teamLangs()).get(NEW_LANG)).toBe(await ownTeamId());
    const { rows } = await db().query(`select "id" from "team"`);
    expect(rows.map((row) => row.id)).toContain(await ownTeamId());
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
    expect(await teamOf(NEW_LANG)).toBe(await ownTeamId());
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

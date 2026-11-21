/** Needs DATABASE_URL and migrations applied. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { recordActivity } from "@/lib/activity/store";
import { closeDb, db, inTransaction } from "@/lib/db";
import { asSystem, dropTeam, testUser } from "@/lib/teams/testing";
import { setEnabled } from "@/lib/languages/store";
import { createReport } from "@/lib/reports/store";

import { adoptEnglish, byTeam, forgetTeams, NoTeamError, readAs, sharedLangs, teamOf } from "./store";

// A code nobody has a team for once cleanup has run; vitest.teams.ts gives it one again after.
const NEW_LANG = "deDE";
const IP = `test-teams-${Math.random().toString(36).slice(2, 10)}-ip`;
let user: Awaited<ReturnType<typeof testUser>>;
// Set once the user exists; the first cleanup, before then, matches no activity row.
let USER = "";

async function englishTeam(): Promise<string> {
  const { rows } = await asSystem.query(`select "id" from "team" where "slug" = 'english'`);
  return rows[0].id;
}

/** The team NEW_LANG had before this file took it away, given back at the end. */
let was: string | undefined;

async function cleanup() {
  await asSystem.query(`delete from "team_language" where "lang" = $1`, [NEW_LANG]);
  await asSystem.query(`update "language" set "enabled" = false where "code" = $1`, [NEW_LANG]);
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [USER]);
  await asSystem.query(`delete from "report" where "ip" = $1`, [IP]);
  const { rows: made } = await asSystem.query<{ id: string }>(
    `select "id" from "team" where "slug" ~ $1 and "id" is distinct from $2`,
    [`^${NEW_LANG.toLowerCase()}-[0-9]+$`, was ?? null],
  );
  for (const { id } of made) await dropTeam(id);
  forgetTeams();
}

beforeAll(async () => {
  const { rows } = await asSystem.query<{ team: string | null }>(`select team_of_lang($1) as "team"`, [NEW_LANG]);
  was = rows[0].team ?? undefined;
  await cleanup();
  user = await testUser("test-teams");
  USER = user.id;
});

beforeEach(() => forgetTeams());

afterAll(async () => {
  await cleanup();
  // Back on its own team, for the suites that write German.
  if (was) {
    await asSystem.query(`insert into "team_language" ("teamId", "lang", "packName") values ($1, $2, 'plain')`, [
      was,
      NEW_LANG,
    ]);
  } else await asSystem.query(`select found_lang_team($1)`, [NEW_LANG]);
  forgetTeams();
  await user.cleanup();
  await closeDb();
});

const langRows = async (lang: string) =>
  (await asSystem.query<{ n: number }>(`select count(*)::int as n from "team_language" where "lang" = $1`, [lang]))
    .rows[0].n;

describe("teamOf", () => {
  it("resolves English to the english team", async () => {
    expect(await teamOf("enUS")).toBe(await englishTeam());
  });

  it("rejects for a language with no team", async () => {
    await expect(teamOf(NEW_LANG)).rejects.toBeInstanceOf(NoTeamError);
  });

  it("finds no team for a language switched on that has none", async () => {
    await setEnabled(NEW_LANG, true, USER);
    await expect(teamOf(NEW_LANG)).rejects.toBeInstanceOf(NoTeamError);
    expect(await langRows(NEW_LANG)).toBe(0);
  });
});

describe("adoptEnglish", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  const report = () =>
    createReport({
      source: "quests", lang: NEW_LANG, lineId: null, target: "quest/1/accept", category: "other",
      body: "test", userId: null, name: null, email: null, ip: IP,
    });

  it("gives a language with no team none, as boot runs it", async () => {
    await inTransaction(adoptEnglish);
    forgetTeams();
    expect(await langRows(NEW_LANG)).toBe(0);
    await expect(report()).rejects.toBeInstanceOf(NoTeamError);
  });

  it("gives English a team where it has none, as on an empty database", async () => {
    const client = await db().connect();
    try {
      await client.query("begin");
      await client.query(`delete from "team_language" where "lang" = 'enUS'`);
      await adoptEnglish(client);
      const { rows } = await client.query(`select "packName" from "team_language" where "lang" = 'enUS'`);
      expect(rows).toEqual([{ packName: "plain" }]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});

describe("a language switched on by the other worker", () => {
  // As the other pm2 worker's setEnabled does: the row, and no forgetTeams in this process.
  const enableElsewhere = () =>
    db().query(
      `insert into "team_language" ("teamId", "lang", "packName") select "id", $1, 'plain' from "team" where "slug" = 'english'`,
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
    await sharedLangs();
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

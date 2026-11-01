/**
 * For tests: a language moved onto a team of its own, and back. On a test database every
 * language shares the english team, so only a moved language makes "the job's team" observable.
 */
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { afterAll } from "vitest";

import { db } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import { forgetTeams, type TeamId } from "./store";

let fixtures: Pool | undefined;

/**
 * A pool of its own whose sessions act as ALL_TEAMS from the start, as the same role as db():
 * a fixture's statement is one round trip, where withTeam's transaction is four.
 */
function fixturePool(): Pool {
  const role = process.env.DATABASE_ROLE ? `-c role=${process.env.DATABASE_ROLE} ` : "";
  fixtures ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2, options: `${role}-c spoken.team=*` });
  return fixtures;
}

// Registered by the first import, so it runs after the test file's own teardown, which may
// still clean up through asSystem.
afterAll(async () => {
  const pool = fixtures;
  fixtures = undefined;
  await pool?.end();
});

/**
 * For fixtures: as ALL_TEAMS, one statement at a time.
 *
 * The suite acts as the app role, so a test's own seeding, inspection and cleanup of per-team
 * rows would meet row-level security; the code under test is still bound by it.
 */
export const asSystem = {
  // `any` by default, as pg's own query is, so a fixture moved here keeps its untyped reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<R extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<R>> {
    return fixturePool().query<R>(text, params);
  },
};

/** One statement's rows, as ALL_TEAMS: query() of lib/db.ts for fixtures. */
export async function systemRows<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<R[]> {
  return (await asSystem.query<R>(text, params)).rows;
}

/** Tables a test may leave rows in under the borrowed team, deleted before the team is. */
const STAMPED = [
  "regeneration_pause", "regeneration_batch", "take_ack", "take", "recording", "activity", "report", "line_ignore",
  "voice_assignment", "voice", "generation_setting", "queue_dismissal",
];

/**
 * What every team has a copy of, copied from the english team as migration 0089 copied it to
 * every team: the roster, the base generation settings and the dismissal mark.
 */
const COPIED = [
  `insert into "voice" ("teamId", "name", "race", "gender")
   select $1, "name", "race", "gender" from "voice" where "teamId" = $2`,
  `insert into "voice_assignment" ("teamId", "race", "gender", "flavor", "voice")
   select $1, "race", "gender", "flavor", "voice" from "voice_assignment" where "teamId" = $2`,
  `insert into "generation_setting" ("teamId", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy")
   select $1, "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedBy"
     from "generation_setting" where "teamId" = $2`,
  `insert into "queue_dismissal" ("teamId", "throughJobId", "dismissedBy")
   select $1, "throughJobId", "dismissedBy" from "queue_dismissal" where "teamId" = $2`,
];

/** For tests: a language with no privileged team, as one not yet switched on has, and back. */
export async function unowned(lang: Lang): Promise<{ restore: () => Promise<void> }> {
  const { rows: was } = await db().query<{ teamId: TeamId }>(
    `delete from "team_language" where "lang" = $1 and "privileged" returning "teamId"`,
    [lang],
  );
  forgetTeams();
  return {
    async restore() {
      if (was[0]) {
        await db().query(`insert into "team_language" ("teamId", "lang") values ($1, $2)`, [was[0].teamId, lang]);
      }
      forgetTeams();
    },
  };
}

export async function ownTeam(lang: Lang): Promise<{ team: TeamId; restore: () => Promise<void> }> {
  const slug = `test-${lang.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await db().query<{ id: TeamId }>(
    `insert into "team" ("slug", "name") values ($1, $1) returning "id"`,
    [slug],
  );
  const team = rows[0].id;
  const previous = await unowned(lang);
  await db().query(`insert into "team_language" ("teamId", "lang") values ($1, $2)`, [team, lang]);
  const { rows: english } = await db().query<{ id: TeamId }>(`select "id" from "team" where "slug" = 'english'`);
  for (const sql of COPIED) await asSystem.query(sql, [team, english[0].id]);
  forgetTeams();

  return {
    team,
    async restore() {
      for (const table of STAMPED) {
        await asSystem.query(`delete from "${table}" where "teamId" = $1`, [team]);
      }
      await db().query(`delete from "team_language" where "teamId" = $1`, [team]);
      await previous.restore();
      await db().query(`delete from "team" where "id" = $1`, [team]);
      forgetTeams();
    },
  };
}

export async function testUser(prefix = "test-user"): Promise<{ id: string; cleanup: () => Promise<void> }> {
  const id = `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, false)`,
    [id, `${id}@example.invalid`],
  );
  return {
    id,
    async cleanup() {
      await asSystem.query(`delete from "user" where "id" = $1`, [id]);
    },
  };
}

/** A running job, which no move gets past. */
export async function runningJob(lang: Lang, team: TeamId): Promise<{ cleanup: () => Promise<void> }> {
  const tag = Math.random().toString(36).slice(2, 10);
  const [batch] = await systemRows<{ id: string }>(
    `insert into "regeneration_batch" ("label", "lang", "teamId") values ($1, $2, $3) returning "id"`,
    [`running-${tag}`, lang, team],
  );
  await asSystem.query(
    `insert into "regeneration_job" ("batchId", "lineId", "file", "npcName", "preview", "characters", "state", "lang", "teamId")
     values ($1, $2, 'busy.mp3', '', '', 1, 'running', $3, $4)`,
    [batch.id, `g:${tag}`, lang, team],
  );
  return {
    async cleanup() {
      await asSystem.query(`delete from "regeneration_job" where "batchId" = $1`, [batch.id]);
      await asSystem.query(`delete from "regeneration_batch" where "id" = $1`, [batch.id]);
    },
  };
}

/** The caller deletes any rows under the team beyond its members, roster and languages first. */
export async function dropTeam(team: TeamId): Promise<void> {
  for (const table of ["team_member", "voice_assignment", "voice", "generation_setting", "queue_dismissal", "team_language"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = $1`, [team]);
  }
  await asSystem.query(`delete from "team" where "id" = $1`, [team]);
}

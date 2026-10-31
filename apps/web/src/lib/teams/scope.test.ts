/**
 * The team-scope migration gives every per-team row the team that owns it. These assert what
 * must hold of whatever database it ran against, rather than inserting rows: other suites
 * share it. The insert checks roll back.
 *
 * Until the app writes inside withTeam, any suite's insert gets a null team, and some put a
 * row back after the test -- the lexicon's singleton, for one -- so a null team proves
 * nothing about the migration. A wrong team always does, so that is what every table is held
 * to. That the backfill reached every row is held of activity, which is append-only and the
 * largest: a row older than the migration was the backfill's to fill.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it } from "vitest";

import { ALL_TEAMS, closeDb, db, withTeam } from "@/lib/db";

afterAll(closeDb);

/** Tables with a `lang` column, whose team is that language's privileged one. */
const BY_LANG = [
  "take",
  "recording",
  "take_ack",
  "voice_clone",
  "fish_reference",
  "generation_setting_locale",
  "pronunciation_lexicon_locale",
  "lexicon_change",
  "line_ignore",
  "line_flag",
  "line_issue",
  "report",
  "regeneration_batch",
  "regeneration_job",
  "regeneration_pause",
  "activity",
];

/** Tables with no language of their own: today they are English's. */
const ENGLISH = [
  "voice",
  "voice_assignment",
  "generation_setting",
  "pronunciation_lexicon",
  "queue_dismissal",
  "line_override",
];

const privileged = (lang: string) =>
  `select "teamId" from "team_language" tl where tl."lang" = ${lang} and tl."privileged"`;

const MIGRATED = `select "applied_at" from "schema_migrations"
                   where "name" = '0088_team_scope.sql'`;

/** Rows matching `where` whose team is set and is not `expected`. */
async function wrong(table: string, expected: string, where = "true"): Promise<number> {
  const { rows } = await db().query(
    `select count(*)::int as "n" from "${table}" t
      where (${where}) and t."teamId" is not null and t."teamId" is distinct from (${expected})`,
  );
  return rows[0].n;
}

describe("team scope", () => {
  it.each(BY_LANG)("gives %s the privileged team of its lang", async (table) => {
    expect(await wrong(table, privileged(`t."lang"`), `t."lang" is not null`)).toBe(0);
  });

  it.each(["line_ignore", "activity"])("leaves site-wide %s rows without a team", async (table) => {
    const { rows } = await db().query(
      `select count(*)::int as "n" from "${table}" where "lang" is null and "teamId" is not null`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("backfilled every activity row that has a language", async () => {
    const { rows } = await db().query(
      `select count(*)::int as "n" from "activity"
        where "lang" is not null and "teamId" is null and "at" <= (${MIGRATED})`,
    );
    expect(rows[0].n).toBe(0);
  });

  it.each(ENGLISH)("gives %s the english team", async (table) => {
    expect(await wrong(table, `select "id" from "team" where "slug" = 'english'`)).toBe(0);
  });

  it("gives voice_sample the team of its clone's language", async () => {
    const lang = `coalesce(nullif(split_part(t."clone", '@', 2), ''), 'enUS')`;
    expect(await wrong("voice_sample", privileged(lang))).toBe(0);
  });

  it("gives line_issue_line its issue's team", async () => {
    const issue = `select i."teamId" from "line_issue" i where i."id" = t."issueId"`;
    expect(await wrong("line_issue_line", issue)).toBe(0);
  });

  it("fills teamId from withTeam on an insert that does not name it", async () => {
    const { rows } = await db().query(`select "id" from "team" where "slug" = 'english'`);
    const team: string = rows[0].id;
    const rollback = new Error("rollback");
    let got: unknown;
    await expect(
      withTeam(team, async (client) => {
        const inserted = await client.query(
          `insert into "take" ("source", "lang", "file", "lineId", "version", "origin", "bytes")
           values ('quests', 'enUS', 'quests/scope-test.mp3', 'scope-test', 1, 'generated', 0)
           returning "teamId"`,
        );
        got = inserted.rows[0].teamId;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(got).toBe(team);
  });

  it("leaves teamId null for an insert as every team", async () => {
    const rollback = new Error("rollback");
    let got: unknown = "unset";
    await expect(
      withTeam(ALL_TEAMS, async (client) => {
        const inserted = await client.query(
          `insert into "take" ("source", "lang", "file", "lineId", "version", "origin", "bytes")
           values ('quests', 'enUS', 'quests/scope-test.mp3', 'scope-test', 1, 'generated', 0)
           returning "teamId"`,
        );
        got = inserted.rows[0].teamId;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(got).toBeNull();
  });
});

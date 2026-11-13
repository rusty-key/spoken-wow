/**
 * The contract migration makes every per-team row's team required and keys the tables by it.
 * These assert what must hold of whatever database it ran against, rather than inserting rows
 * that other suites would see; the inserts roll back.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it } from "vitest";

import { ALL_TEAMS, closeDb, db, withTeam } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

afterAll(closeDb);

const TABLES = [
  "take", "recording", "take_ack", "voice", "voice_assignment", "voice_clone", "voice_sample",
  "fish_reference", "generation_setting", "generation_setting_locale", "pronunciation_lexicon",
  "pronunciation_lexicon_locale", "lexicon_change", "line_override", "line_ignore", "line_flag",
  "line_issue", "line_issue_line", "report", "regeneration_batch", "regeneration_job",
  "regeneration_pause", "queue_dismissal", "activity",
];

/** Site-wide rows: no language, so no team. */
const SITE_WIDE = ["line_ignore", "activity"];

const ENGLISH = `select "id" from "team" where "slug" = 'english'`;

const rollback = new Error("rollback");

/** The error `sql` raised as `team`, rolled back either way. */
async function failure(team: string, sql: string, params: unknown[] = []): Promise<unknown> {
  let got: unknown = null;
  await withTeam(team, async (client) => {
    await client.query(sql, params).catch((error: unknown) => {
      got = error;
    });
    throw rollback;
  }).catch((error: unknown) => {
    if (error !== rollback) throw error;
  });
  return got;
}

describe("team contract", () => {
  it.each(TABLES)("leaves no %s row without a team but a site-wide one", async (table) => {
    const siteWide = SITE_WIDE.includes(table) ? ` and "lang" is not null` : "";
    const { rows } = await asSystem.query(
      `select count(*)::int as "n" from "${table}" where "teamId" is null${siteWide}`,
    );
    expect(rows[0].n).toBe(0);
  });

  it.each(TABLES.filter((t) => !SITE_WIDE.includes(t)))("requires a team on %s", async (table) => {
    const { rows } = await asSystem.query(
      `select "is_nullable" from "information_schema"."columns"
        where "table_name" = $1 and "column_name" = 'teamId'`,
      [table],
    );
    expect(rows[0].is_nullable).toBe("NO");
  });

  it("refuses a take with no team", async () => {
    const error = await failure(
      ALL_TEAMS,
      `insert into "take" ("source", "lang", "file", "lineId", "version", "origin", "bytes")
       values ('quests', 'enUS', 'quests/contract-test.mp3', 'contract-test', 1, 'generated', 0)`,
    );
    expect(error).toMatchObject({ code: "23502" });
  });

  it("gives every team the english team's roster", async () => {
    const { rows } = await asSystem.query<{ slug: string; voices: string; assignments: string }>(
      `select t."slug",
              (select string_agg(v."name", ',' order by v."name") from "voice" v
                where v."teamId" = t."id") as "voices",
              (select string_agg(a."key", ',' order by a."key")
                 from (select "teamId", "race" || ':' || coalesce("gender", '') || ':' || coalesce("flavor", '') as "key"
                         from "voice_assignment") a
                where a."teamId" = t."id") as "assignments"
         from "team" t
        where t."slug" not like 'test-%'`,
    );
    const english = rows.find((row) => row.slug === "english")!;
    expect(english.voices).toBeTruthy();
    for (const row of rows) {
      expect({ slug: row.slug, voices: row.voices, assignments: row.assignments })
        .toEqual({ slug: row.slug, voices: english.voices, assignments: english.assignments });
    }
  });

  // Not queue_dismissal: each team keeps its own mark (dismissThrough), so English dismissing a
  // run leaves the others without one. A new team's copy of it is move.test.ts's to check.
  it("gives every team a generation_setting row if English has one", async () => {
    const { rows } = await asSystem.query(
      `select count(*)::int as "n" from "team" t
        where t."slug" not like 'test-%'
          and exists (select 1 from "generation_setting" where "teamId" = (${ENGLISH}))
          and not exists (select 1 from "generation_setting" where "teamId" = t."id")`,
    );
    expect(rows[0].n).toBe(0);
  });

  it("keys a voice assignment to a voice of its own team", async () => {
    const { rows } = await asSystem.query(`select "id" from "team" where "slug" = 'english'`);
    const english: string = rows[0].id;
    const { rows: other } = await asSystem.query(
      `insert into "team" ("slug", "name") values ($1, $1) returning "id"`,
      [`test-contract-${Math.random().toString(36).slice(2, 8)}`],
    );
    try {
      // As ALL_TEAMS, so the copy can read English's row and name the other team itself.
      const error = await failure(
        ALL_TEAMS,
        `insert into "voice_assignment" ("teamId", "race", "gender", "flavor", "voice")
         select $2, "race", "gender", "flavor", "voice" from "voice_assignment" where "teamId" = $1 limit 1`,
        [english, other[0].id],
      );
      expect(error).toMatchObject({ code: "23503" });
    } finally {
      await asSystem.query(`delete from "team" where "id" = $1`, [other[0].id]);
    }
  });

  it("keeps one site-wide ignore per line", async () => {
    const lineId = `contract-test-${Math.random().toString(36).slice(2, 8)}`;
    const error = await failure(
      ALL_TEAMS,
      `insert into "line_ignore" ("lineId", "lang", "reason", "teamId")
       values ($1, null, 'one', null), ($1, null, 'two', null)`,
      [lineId],
    );
    expect(error).toMatchObject({ code: "23505" });
  });

  it("refuses a site-wide ignore with a team, and a language's without one", async () => {
    const english = (await asSystem.query(ENGLISH)).rows[0].id;
    expect(await failure(
      ALL_TEAMS,
      `insert into "line_ignore" ("lineId", "lang", "reason", "teamId") values ('contract-test', null, 'x', $1)`,
      [english],
    )).toMatchObject({ code: "23514" });
    expect(await failure(
      ALL_TEAMS,
      `insert into "line_ignore" ("lineId", "lang", "reason", "teamId") values ('contract-test', 'deDE', 'x', null)`,
    )).toMatchObject({ code: "23514" });
  });
});

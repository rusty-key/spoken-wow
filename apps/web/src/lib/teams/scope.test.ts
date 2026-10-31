/**
 * The team-scope migration gives every per-team row the team that owns it. These assert what
 * must hold of whatever database it ran against, rather than inserting rows: other suites
 * share it. The insert checks roll back.
 *
 * Until the app writes inside withTeam, any suite's insert gets a null team, and some put a
 * row back after the test -- the lexicon's singleton, for one -- so a null team on a row
 * written since the migration proves nothing about it. A wrong team always does, so that is
 * what every table is held to. That the backfill reached every row is held of the tables that
 * stamp a row when it is made: a row stamped before the migration was the backfill's to fill.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db, withTeam } from "@/lib/db";
import { asSystem } from "@/lib/teams/testing";

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

/**
 * Tables with no language of their own that are English's alone. The roster, the base
 * generation settings and the dismissal mark were too, until 0089 gave every team a copy.
 */
const ENGLISH = ["pronunciation_lexicon", "line_override"];

const MIGRATED = `select "applied_at" from "schema_migrations"
                   where "name" = '0088_team_scope_2_backfill.sql'`;

/** Each table that records when a row was made, with that column. */
const STAMPED: Record<string, string> = {
  take: "createdAt",
  recording: "createdAt",
  take_ack: "ackedAt",
  voice: "createdAt",
  voice_clone: "clonedAt",
  voice_sample: "uploadedAt",
  lexicon_change: "changedAt",
  line_ignore: "createdAt",
  report: "createdAt",
  regeneration_batch: "createdAt",
  regeneration_job: "queuedAt",
  regeneration_pause: "pausedAt",
  queue_dismissal: "dismissedAt",
  activity: "at",
};

/** Rows matching `where` whose team is set and is not `expected`. */
async function wrong(table: string, expected: string, where = "true"): Promise<number> {
  const { rows } = await asSystem.query(
    `select count(*)::int as "n" from "${table}" t
      where (${where}) and t."teamId" is not null and t."teamId" is distinct from (${expected})`,
  );
  return rows[0].n;
}

describe("team scope", () => {
  it.each(BY_LANG)("gives %s the privileged team of its lang", async (table) => {
    expect(await wrong(table, `select team_of_lang(t."lang")`, `t."lang" is not null`)).toBe(0);
  });

  it.each(["line_ignore", "activity"])("leaves site-wide %s rows without a team", async (table) => {
    const { rows } = await asSystem.query(
      `select count(*)::int as "n" from "${table}" where "lang" is null and "teamId" is not null`,
    );
    expect(rows[0].n).toBe(0);
  });

  it.each(Object.entries(STAMPED))("backfilled every %s row older than it", async (table, at) => {
    const siteWide = ["line_ignore", "activity"].includes(table) ? ` and "lang" is not null` : "";
    const { rows } = await asSystem.query(
      `select count(*)::int as "n" from "${table}"
        where "teamId" is null and "${at}" <= (${MIGRATED})${siteWide}`,
    );
    expect(rows[0].n).toBe(0);
  });

  it.each(ENGLISH)("gives %s the english team", async (table) => {
    expect(await wrong(table, `select "id" from "team" where "slug" = 'english'`)).toBe(0);
  });

  it("gives voice_sample the team of its clone's language", async () => {
    const lang = `coalesce(nullif(split_part(t."clone", '@', 2), ''), 'enUS')`;
    expect(await wrong("voice_sample", `select team_of_lang(${lang})`)).toBe(0);
  });

  it("gives line_issue_line its issue's team", async () => {
    const issue = `select i."teamId" from "line_issue" i where i."id" = t."issueId"`;
    expect(await wrong("line_issue_line", issue)).toBe(0);
  });

  it("fills teamId from withTeam on an insert that does not name it", async () => {
    const { rows } = await asSystem.query(`select "id" from "team" where "slug" = 'english'`);
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
});

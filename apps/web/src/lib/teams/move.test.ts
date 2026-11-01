/** Needs DATABASE_URL and migrations through 0091 applied. */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { forgetTeams } from "./store";
import { asSystem, dropTeam, ownTeam, runningJob, systemRows, testUser } from "./testing";

/** Tables the target may end up with rows in beyond what dropTeam deletes, children first. */
const TARGET_ROWS = [
  "line_issue_line", "line_issue", "voice_sample", "voice_clone", "report", "take", "regeneration_job",
  "regeneration_batch",
];

let source: Awaited<ReturnType<typeof ownTeam>>;
let target: string;
let tag: string;
let user: Awaited<ReturnType<typeof testUser>>;

async function teamOfLang(lang: string): Promise<string | null> {
  return (await systemRows<{ team: string | null }>(`select team_of_lang($1) as "team"`, [lang]))[0].team;
}

/**
 * A base settings row and a dismissal mark on `team` where it has none, as a database that has
 * saved settings and dismissed a run has; a fresh one has neither. Removes only what it added.
 */
async function baseRows(team: string): Promise<() => Promise<void>> {
  const added: string[] = [];
  const setting = await systemRows(
    `insert into "generation_setting" ("teamId", "modelId", "voiceSettings", "seedStrategy")
     values ($1, 'eleven_v3', '{}', 'none') on conflict do nothing returning 1`,
    [team],
  );
  if (setting.length) added.push("generation_setting");
  const dismissal = await systemRows(
    `insert into "queue_dismissal" ("teamId", "throughJobId") values ($1, 0) on conflict do nothing returning 1`,
    [team],
  );
  if (dismissal.length) added.push("queue_dismissal");
  return async () => {
    for (const table of added) await asSystem.query(`delete from "${table}" where "teamId" = $1`, [team]);
  };
}

async function hasRow(table: string, team: string): Promise<boolean> {
  return (await systemRows(`select 1 from "${table}" where "teamId" = $1`, [team])).length === 1;
}

function move(lang: string, team: string) {
  return asSystem.query<{ moved: number }>(`select move_team_lang($1, $2) as "moved"`, [lang, team]);
}

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  user = await testUser("test-move");
  source = await ownTeam("deDE");
  // new_team, not ownTeam: a target with no roster is what the copy is for.
  const { rows } = await asSystem.query<{ id: string }>(`select new_team($1, $1) as "id"`, [`test-move-${tag}`]);
  target = rows[0].id;
});

afterEach(async () => {
  for (const table of TARGET_ROWS) await asSystem.query(`delete from "${table}" where "teamId" = $1`, [target]);
  await dropTeam(target);
  // A refused move leaves the seeded rows on the source team.
  for (const table of ["line_issue_line", "line_issue", "voice_sample", "voice_clone", "regeneration_job"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = $1`, [source.team]);
  }
  await source.restore();
  await user.cleanup();
  forgetTeams();
});

afterAll(closeDb);

describe("move_team_lang", () => {
  it("moves every row of the language to the new team", async () => {
    const team = source.team;
    const take = await systemRows<{ id: string }>(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
       values ('quests', 'deDE', $1, 'g:move', 1, true, 'generated', 1, $2) returning "id"`,
      [`gossip/${tag}move.mp3`, team],
    );
    const report = await systemRows<{ id: string }>(
      `insert into "report" ("source", "lang", "category", "body", "teamId")
       values ('quests', 'deDE', 'other', $1, $2) returning "id"`,
      [`move-${tag}`, team],
    );
    await asSystem.query(
      `insert into "voice_clone" ("voice", "voiceId", "sampleCount", "sampleBytes", "lang", "teamId")
       values ($1, $1, 1, 1, 'deDE', $2)`,
      [`move-${tag}`, team],
    );
    await asSystem.query(
      `insert into "voice_sample" ("clone", "file", "sha256", "bytes", "teamId") values ($1, 'a.mp3', 'x', 1, $2)`,
      [`move-${tag}@deDE`, team],
    );
    const issue = await systemRows<{ id: string }>(
      `insert into "line_issue" ("category", "item", "severity", "note", "occurrences", "scanAt", "lang", "teamId")
       values ('move', $1, 1, '', 1, now(), 'deDE', $2) returning "id"`,
      [`move-${tag}`, team],
    );
    await asSystem.query(
      `insert into "line_issue_line" ("issueId", "lineId", "teamId") values ($1, 'g:move', $2)`,
      [issue[0].id, team],
    );

    await asSystem.query(
      `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, 'deDE', 'regenerate')`,
      [team, user.id],
    );

    const { rows } = await move("deDE", target);
    expect(rows[0].moved).toBe(7);

    const teams = await systemRows<{ team: string }>(
      `select "teamId" as "team" from "take" where "id" = $1
       union all select "teamId" from "report" where "id" = $2
       union all select "teamId" from "voice_clone" where "voice" = $3
       union all select "teamId" from "voice_sample" where "clone" = $3 || '@deDE'
       union all select "teamId" from "line_issue" where "id" = $4
       union all select "teamId" from "line_issue_line" where "issueId" = $4
      union all select "teamId" from "team_member" where "userId" = $5`,
      [take[0].id, report[0].id, `move-${tag}`, issue[0].id, user.id],
    );
    expect(teams.map((row) => row.team)).toEqual(Array(7).fill(target));
    expect(await teamOfLang("deDE")).toBe(target);
  });

  it("copies the roster to a team that has none", async () => {
    // Cleared with the source team by restore().
    await baseRows(source.team);
    await move("deDE", target);

    const counts = await systemRows<{ team: string; n: number }>(
      `select "teamId" as "team", count(*)::int as "n" from "voice" where "teamId" = any($1) group by 1`,
      [[source.team, target]],
    );
    const of = (team: string) => counts.find((row) => row.team === team)?.n;
    expect(of(source.team)).toBeGreaterThan(0);
    expect(of(target)).toBe(of(source.team));
    expect(await hasRow("generation_setting", target)).toBe(true);
    expect(await hasRow("queue_dismissal", target)).toBe(true);
  });

  it("refuses while a job runs", async () => {
    const job = await runningJob("deDE", source.team);

    await expect(move("deDE", target)).rejects.toMatchObject({ code: "55006", message: expect.stringMatching(/running/) });
    expect(await teamOfLang("deDE")).toBe(source.team);

    await job.cleanup();
  });

  it("refuses enUS", async () => {
    await expect(move("enUS", target)).rejects.toThrow(/enUS/);
  });

  it("refuses an unknown team", async () => {
    await expect(move("deDE", randomUUID())).rejects.toThrow(/no team/);
    expect(await teamOfLang("deDE")).toBe(source.team);
  });

  it("refuses a team that already holds the language", async () => {
    await expect(move("deDE", source.team)).rejects.toThrow(/already holds/);
    expect(await teamOfLang("deDE")).toBe(source.team);
  });

  it("leaves another language's rows alone", async () => {
    const take = await systemRows<{ id: string }>(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
       values ('quests', 'frFR', $1, 'g:move', 1, true, 'generated', 1, $2) returning "id"`,
      [`gossip/${tag}move.mp3`, source.team],
    );

    await move("deDE", target);

    const rows = await systemRows<{ team: string }>(`select "teamId" as "team" from "take" where "id" = $1`, [take[0].id]);
    expect(rows[0].team).toBe(source.team);
  });
});

describe("adopt_lang", () => {
  // A code no fixture or suite uses, so it is unowned and its team is new.
  const LANG = "qaQA";

  async function drop() {
    const team = (await systemRows<{ id: string }>(`select "id" from "team" where "slug" = 'qaqa'`))[0]?.id;
    if (!team) return;
    await dropTeam(team);
  }

  afterEach(drop);

  it("gives an unowned language a team of its own with English's roster", async () => {
    await drop();
    const english = (await systemRows<{ id: string }>(`select "id" from "team" where "slug" = 'english'`))[0].id;
    const unseed = await baseRows(english);
    try {
      // As the app calls it: its own role, acting as no team.
      await db().query(`select adopt_lang($1)`, [LANG]);
    } finally {
      await unseed();
    }

    const team = await teamOfLang(LANG);
    const counts = await systemRows<{ english: number; adopted: number }>(
      `select (select count(*)::int from "voice" v join "team" t on t."id" = v."teamId" where t."slug" = 'english') as "english",
              (select count(*)::int from "voice" where "teamId" = $1) as "adopted"`,
      [team],
    );
    expect(counts[0].english).toBeGreaterThan(0);
    expect(counts[0].adopted).toBe(counts[0].english);
    expect(await hasRow("generation_setting", team!)).toBe(true);
    expect(await hasRow("queue_dismissal", team!)).toBe(true);
  });
});

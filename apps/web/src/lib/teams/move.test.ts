/**
 * move_team_lang (migration 0091): a language handed to another team takes every row with it.
 *
 * Needs DATABASE_URL and migrations through 0091 applied.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";

import { forgetTeams } from "./store";
import { asSystem, ownTeam, systemRows } from "./testing";

/** Tables the target may end up with rows in, children first. */
const TARGET_ROWS = [
  "line_issue_line", "line_issue", "voice_sample", "voice_clone", "report", "take", "regeneration_job",
  "regeneration_batch", "voice_assignment", "voice", "generation_setting", "queue_dismissal",
];

let source: Awaited<ReturnType<typeof ownTeam>>;
let target: string;
let tag: string;

async function teamOfLang(lang: string): Promise<string | null> {
  return (await systemRows<{ team: string | null }>(`select team_of_lang($1) as "team"`, [lang]))[0].team;
}

function move(lang: string, team: string) {
  return asSystem.query<{ moved: number }>(`select move_team_lang($1, $2) as "moved"`, [lang, team]);
}

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  source = await ownTeam("deDE");
  // new_team, not ownTeam: a target with no roster is what the copy is for.
  const { rows } = await asSystem.query<{ id: string }>(`select new_team($1, $1) as "id"`, [`test-move-${tag}`]);
  target = rows[0].id;
});

afterEach(async () => {
  for (const table of TARGET_ROWS) await asSystem.query(`delete from "${table}" where "teamId" = $1`, [target]);
  await asSystem.query(`delete from "team_language" where "teamId" = $1`, [target]);
  await asSystem.query(`delete from "team" where "id" = $1`, [target]);
  // A refused move leaves the seeded rows on the source team.
  for (const table of ["line_issue_line", "line_issue", "voice_sample", "voice_clone", "regeneration_job"]) {
    await asSystem.query(`delete from "${table}" where "teamId" = $1`, [source.team]);
  }
  await source.restore();
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

    const { rows } = await move("deDE", target);
    expect(rows[0].moved).toBeGreaterThanOrEqual(6);

    const teams = await systemRows<{ team: string }>(
      `select "teamId" as "team" from "take" where "id" = $1
       union all select "teamId" from "report" where "id" = $2
       union all select "teamId" from "voice_clone" where "voice" = $3
       union all select "teamId" from "voice_sample" where "clone" = $3 || '@deDE'
       union all select "teamId" from "line_issue" where "id" = $4
       union all select "teamId" from "line_issue_line" where "issueId" = $4`,
      [take[0].id, report[0].id, `move-${tag}`, issue[0].id],
    );
    expect(teams.map((row) => row.team)).toEqual(Array(6).fill(target));
    expect(await teamOfLang("deDE")).toBe(target);
  });

  it("copies the roster to a team that has none", async () => {
    await move("deDE", target);

    const counts = await systemRows<{ team: string; n: number }>(
      `select "teamId" as "team", count(*)::int as "n" from "voice" where "teamId" = any($1) group by 1`,
      [[source.team, target]],
    );
    const of = (team: string) => counts.find((row) => row.team === team)?.n;
    expect(of(source.team)).toBeGreaterThan(0);
    expect(of(target)).toBe(of(source.team));
    const settings = await systemRows(`select 1 from "generation_setting" where "teamId" = $1`, [target]);
    expect(settings).toHaveLength(1);
  });

  it("refuses while a job runs", async () => {
    const batch = await systemRows<{ id: string }>(
      `insert into "regeneration_batch" ("label", "lang", "teamId") values ($1, 'deDE', $2) returning "id"`,
      [`move-${tag}`, source.team],
    );
    await asSystem.query(
      `insert into "regeneration_job" ("batchId", "lineId", "file", "npcName", "preview", "characters", "state", "lang", "teamId")
       values ($1, 'g:move', 'move.mp3', '', '', 1, 'running', 'deDE', $2)`,
      [batch[0].id, source.team],
    );

    await expect(move("deDE", target)).rejects.toThrow(/running/);
    expect(await teamOfLang("deDE")).toBe(source.team);

    await asSystem.query(`delete from "regeneration_batch" where "id" = $1`, [batch[0].id]);
  });

  it("refuses enUS", async () => {
    await expect(move("enUS", target)).rejects.toThrow(/enUS/);
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

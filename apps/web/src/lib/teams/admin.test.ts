/**
 * The team store: creating, renaming and handing a language to a team.
 *
 * Needs DATABASE_URL and migrations through 0091 applied.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";

import { createTeam, handOver, listTeams, renameTeam, TeamBusyError, TeamInputError } from "./admin";
import { adoptLang, forgetTeams, teamOf } from "./store";
import { asSystem, systemRows, unowned } from "./testing";

let tag: string;
let actor: string;
let was: string;
let made: string[];

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  actor = `test-admin-${tag}`;
  made = [];
  await asSystem.query(
    `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, false)`,
    [actor, `${actor}@example.invalid`],
  );
  forgetTeams();
  was = await teamOf("deDE");
});

afterEach(async () => {
  // Hand deDE back first, so the test teams hold nothing when they go.
  const now = (await systemRows<{ team: string }>(`select team_of_lang('deDE') as "team"`))[0].team;
  if (now !== was) await asSystem.query(`select move_team_lang('deDE', $1)`, [was]);
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [actor]);
  for (const team of made) {
    for (const table of ["team_member", "voice_assignment", "voice", "generation_setting", "queue_dismissal"]) {
      await asSystem.query(`delete from "${table}" where "teamId" = $1`, [team]);
    }
    await asSystem.query(`delete from "team_language" where "teamId" = $1`, [team]);
    await asSystem.query(`delete from "team" where "id" = $1`, [team]);
  }
  await asSystem.query(`delete from "user" where "id" = $1`, [actor]);
  forgetTeams();
});

afterAll(closeDb);

async function newTeam(slug = `t-${tag}`): Promise<string> {
  const team = await createTeam({ slug, name: `Team ${tag}`, adminEmail: null }, actor);
  made.push(team);
  return team;
}

describe("createTeam", () => {
  it("refuses a slug that is not lowercase letters, digits and dashes", async () => {
    await expect(createTeam({ slug: "Bad Slug", name: "x", adminEmail: null }, actor)).rejects.toBeInstanceOf(TeamInputError);
  });

  it("refuses a slug already taken", async () => {
    await newTeam();
    await expect(createTeam({ slug: `t-${tag}`, name: "again", adminEmail: null }, actor)).rejects.toBeInstanceOf(TeamInputError);
  });

  it("refuses an admin email nobody has", async () => {
    await expect(
      createTeam({ slug: `t-${tag}`, name: "x", adminEmail: "nobody@example.invalid" }, actor),
    ).rejects.toBeInstanceOf(TeamInputError);
    expect(await systemRows(`select 1 from "team" where "slug" = $1`, [`t-${tag}`])).toHaveLength(0);
  });

  it("accepts a known admin email and writes the team alone", async () => {
    const team = await createTeam({ slug: `t-${tag}`, name: "x", adminEmail: `${actor}@example.invalid` }, actor);
    made.push(team);
    expect(await systemRows(`select 1 from "team_member" where "teamId" = $1`, [team])).toHaveLength(0);
    expect(await systemRows(`select 1 from "team_language" where "teamId" = $1`, [team])).toHaveLength(0);
  });
});

describe("renameTeam", () => {
  it("changes the name and logs it", async () => {
    const team = await newTeam();
    await renameTeam(team, "Renamed", actor);
    const rows = await systemRows<{ name: string }>(`select "name" from "team" where "id" = $1`, [team]);
    expect(rows[0].name).toBe("Renamed");
    const log = await systemRows(`select 1 from "activity" where "kind" = 'team.renamed' and "actorId" = $1`, [actor]);
    expect(log).toHaveLength(1);
  });
});

describe("handOver", () => {
  it("moves the language, forgets the memo and logs it", async () => {
    const team = await newTeam();
    expect(await handOver("deDE", team, actor)).toBeGreaterThan(0);
    expect(await teamOf("deDE")).toBe(team);
    const log = await systemRows<{ teamId: string; detail: { from: string; to: string } }>(
      `select "teamId", "detail" from "activity" where "kind" = 'team.language_moved' and "actorId" = $1`,
      [actor],
    );
    expect(log).toHaveLength(1);
    expect(log[0].detail.to).toBe(`t-${tag}`);
  });

  it("refuses English", async () => {
    const team = await newTeam();
    await expect(handOver("enUS", team, actor)).rejects.toBeInstanceOf(TeamInputError);
  });

  it("refuses while a job of the language is running", async () => {
    const team = await newTeam();
    const batch = await systemRows<{ id: string }>(
      `insert into "regeneration_batch" ("label", "lang", "teamId") values ($1, 'deDE', $2) returning "id"`,
      [`admin-${tag}`, was],
    );
    await asSystem.query(
      `insert into "regeneration_job" ("batchId", "lineId", "file", "npcName", "preview", "characters", "state", "lang", "teamId")
       values ($1, $2, 'busy.mp3', '', '', 1, 'running', 'deDE', $3)`,
      [batch[0].id, `g:${tag}`, was],
    );
    try {
      await expect(handOver("deDE", team, actor)).rejects.toBeInstanceOf(TeamBusyError);
    } finally {
      await asSystem.query(`delete from "regeneration_job" where "batchId" = $1`, [batch[0].id]);
      await asSystem.query(`delete from "regeneration_batch" where "id" = $1`, [batch[0].id]);
    }
  });
});

describe("listTeams", () => {
  it("lists a team with the languages it holds", async () => {
    const team = await newTeam();
    await handOver("deDE", team, actor);
    const found = (await listTeams()).find((t) => t.id === team);
    expect(found).toMatchObject({ slug: `t-${tag}`, langs: ["deDE"], members: [] });
  });
});

describe("adoptLang", () => {
  it("gives an unowned language a team slugged by its code", async () => {
    // A code no migration made a team for, so the cleanup deletes only what this made.
    const client = await db().connect();
    try {
      await client.query(`select set_config('spoken.team', '*', false)`);
      await adoptLang(client, "zzZZ");
    } finally {
      client.release();
    }
    const rows = await systemRows<{ id: string; slug: string }>(
      `select t."id", t."slug" from "team" t where t."id" = team_of_lang('zzZZ')`,
    );
    expect(rows[0].slug).toBe("zzzz");
    made.push(rows[0].id);
  });
});

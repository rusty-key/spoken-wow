/** Needs DATABASE_URL and migrations through 0091 applied. */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, inTransaction, withTeam } from "@/lib/db";

import { createTeam, handOver, listTeams, liveTakeCounts, renameTeam, TeamError } from "./admin";
import { adoptLang, forgetTeams, teamOf } from "./store";
import { asSystem, dropTeam, runningJob, systemRows, testUser, unowned } from "./testing";

let tag: string;
let user: Awaited<ReturnType<typeof testUser>>;
let actor: string;
let was: string;
let made: string[];

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  user = await testUser("test-admin");
  actor = user.id;
  made = [];
  forgetTeams();
  was = await teamOf("deDE");
});

afterEach(async () => {
  // Hand deDE back first, so the test teams hold nothing when they go.
  const now = (await systemRows<{ team: string }>(`select team_of_lang('deDE') as "team"`))[0].team;
  if (now !== was) await asSystem.query(`select move_team_lang('deDE', $1)`, [was]);
  await asSystem.query(`delete from "activity" where "actorId" = $1`, [actor]);
  for (const team of made) await dropTeam(team);
  await user.cleanup();
  forgetTeams();
});

afterAll(closeDb);

const refused = (status: 400 | 409) => (error: unknown) => error instanceof TeamError && error.status === status;

async function newTeam(slug = `t-${tag}`): Promise<string> {
  const { id: team } = await createTeam({ slug, name: `Team ${tag}`, adminEmail: null }, actor);
  made.push(team);
  return team;
}

describe("createTeam", () => {
  it("refuses a slug that is not lowercase letters, digits and dashes", async () => {
    await expect(createTeam({ slug: "Bad Slug", name: "x", adminEmail: null }, actor)).rejects.toSatisfy(refused(400));
  });

  it("refuses a slug already taken", async () => {
    await newTeam();
    await expect(createTeam({ slug: `t-${tag}`, name: "again", adminEmail: null }, actor)).rejects.toSatisfy(refused(400));
  });

  it("has new_team raise on a taken slug rather than hand that team back", async () => {
    await newTeam();
    await expect(asSystem.query(`select new_team($1, 'again')`, [`t-${tag}`])).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses an admin email nobody has", async () => {
    await expect(
      createTeam({ slug: `t-${tag}`, name: "x", adminEmail: "nobody@example.invalid" }, actor),
    ).rejects.toSatisfy(refused(400));
    expect(await systemRows(`select 1 from "team" where "slug" = $1`, [`t-${tag}`])).toHaveLength(0);
  });

  it("accepts a known admin email and writes the team alone", async () => {
    const { id: team, adminId } = await createTeam({ slug: `t-${tag}`, name: "x", adminEmail: `${actor}@example.invalid` }, actor);
    made.push(team);
    expect(adminId).toBe(actor);
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
    await expect(handOver("enUS", team, actor)).rejects.toSatisfy(refused(400));
  });

  it("refuses while a job of the language is running", async () => {
    const team = await newTeam();
    const job = await runningJob("deDE", was);
    try {
      await expect(handOver("deDE", team, actor)).rejects.toSatisfy(refused(409));
    } finally {
      await job.cleanup();
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

describe("liveTakeCounts", () => {
  it("counts only the live takes of each language, whichever team holds them", async () => {
    const file = `gossip/${tag}count.mp3`;
    const row = (version: number, current: boolean, lang: string) =>
      asSystem.query(
        `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
         values ('quests', $3, $1, 'g:count', $2, $4, 'generated', 1, $5)`,
        [file, version, lang, current, was],
      );
    const before = await liveTakeCounts();
    try {
      await row(1, false, "deDE");
      await row(2, true, "deDE");
      await row(1, true, "frFR");
      const after = await liveTakeCounts();
      expect(after.get("deDE")).toBe((before.get("deDE") ?? 0) + 1);
      expect(after.get("frFR")).toBe((before.get("frFR") ?? 0) + 1);
    } finally {
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
    }
  });
});

describe("adoptLang", () => {
  // As setEnabled and the queue's boot call it: the app role's own transaction, no team set.
  // A code no migration made a team for, so the cleanup deletes only what this made.
  it("gives an unowned language a team slugged by its code, with English's roster", async () => {
    await inTransaction((client) => adoptLang(client, "zzZZ"));
    const rows = await systemRows<{ id: string; slug: string; voices: number; english: number }>(
      `select t."id", t."slug",
              (select count(*)::int from "voice" v where v."teamId" = t."id") as "voices",
              (select count(*)::int from "voice" v join "team" e on e."id" = v."teamId" and e."slug" = 'english') as "english"
         from "team" t where t."id" = team_of_lang('zzZZ')`,
    );
    made.push(rows[0].id);
    expect(rows[0].slug).toBe("zzzz");
    expect(rows[0].english).toBeGreaterThan(0);
    expect(rows[0].voices).toBe(rows[0].english);
  });

  it("makes a team of its own when the code's slug is taken, rather than joining that team", async () => {
    const squatter = await newTeam("zzzz");
    await inTransaction((client) => adoptLang(client, "zzZZ"));
    const rows = await systemRows<{ id: string; slug: string }>(
      `select t."id", t."slug" from "team" t where t."id" = team_of_lang('zzZZ')`,
    );
    made.push(rows[0].id);
    expect(rows[0].id).not.toBe(squatter);
    expect(rows[0].slug).toBe("zzzz-2");
  });

  it("leaves the caller's transaction acting as the team it acted as", async () => {
    const team = await withTeam(was, async (client) => {
      await adoptLang(client, "zzZZ");
      return (await client.query<{ team: string }>(`select current_setting('spoken.team', true) as "team"`)).rows[0].team;
    });
    made.push((await systemRows<{ id: string }>(`select team_of_lang('zzZZ') as "id"`))[0].id);
    expect(team).toBe(was);
  });
});

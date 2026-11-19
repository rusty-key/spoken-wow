/** Needs DATABASE_URL and migrations through 0091 applied. */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, inTransaction, withTeam } from "@/lib/db";

import {
  createTeam,
  createTeamWithLangs,
  deleteTeam,
  handOver,
  listTeams,
  liveTakeCounts,
  renameTeam,
  TeamError,
} from "./admin";
import { forgetTeams, foundLangTeam, teamOf } from "./store";
import { addMember, asSystem, dropLang, dropTeam, newTeamIn, runningJob, systemRows, testUser, uniqueLang, unowned } from "./testing";

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

describe("deleteTeam", () => {
  const exists = async (team: string) => (await systemRows(`select 1 from "team" where "id" = $1`, [team])).length > 0;

  /** With English's roster, as a new team starts. */
  async function secondTeam(): Promise<string> {
    const team = await newTeamIn("deDE", false);
    made.push(team);
    await asSystem.query(`select copy_team_roster((select "id" from "team" where "slug" = 'english'), $1)`, [team]);
    return team;
  }

  it("deletes a second team with its roster, lexicon history, pause and log, recording its members", async () => {
    const team = await secondTeam();
    await addMember(team, actor, "deDE", "admin");
    await asSystem.query(`insert into "activity" ("lang", "kind", "actorId", "teamId") values ('deDE', 'grant.added', $1, $2)`, [
      actor, team,
    ]);
    await asSystem.query(
      `insert into "lexicon_change" ("grapheme", "kind", "versionId", "changedBy", "lang", "teamId")
       values ('Ork', 'added', 'v1', $1, 'deDE', $2)`,
      [actor, team],
    );
    await asSystem.query(`insert into "regeneration_pause" ("lang", "pausedBy", "teamId") values ('deDE', $1, $2)`, [actor, team]);

    await deleteTeam(team, actor);

    expect(await exists(team)).toBe(false);
    for (const table of ["voice", "lexicon_change", "regeneration_pause", "activity"]) {
      expect(await systemRows(`select 1 from "${table}" where "teamId" = $1`, [team])).toHaveLength(0);
    }
    // Deleted, not left under no team, where every team could read it.
    const log = await systemRows<{ kind: string; teamId: string | null; detail: { members: unknown[] } }>(
      `select "kind", "teamId", "detail" from "activity" where "actorId" = $1 order by "id"`,
      [actor],
    );
    expect(log).toEqual([
      {
        kind: "team.deleted",
        teamId: null,
        detail: { slug: expect.any(String), members: [{ email: `${actor}@example.invalid`, lang: "deDE", capability: "admin" }] },
      },
    ]);
  });

  it("refuses a team holding a language, naming it", async () => {
    const team = await newTeam();
    await handOver("deDE", team, actor);
    await expect(deleteTeam(team, actor)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("deDE") });
    expect(await exists(team)).toBe(true);
  });

  it("refuses a team with a take of its own and deletes nothing", async () => {
    const team = await secondTeam();
    const file = `gossip/${tag}delete.mp3`;
    await asSystem.query(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
       values ('quests', 'deDE', $1, 'g:delete', 1, true, 'generated', 1, $2)`,
      [file, team],
    );
    try {
      await expect(deleteTeam(team, actor)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("still has takes of its own"),
      });
      expect(await exists(team)).toBe(true);
      expect(await systemRows(`select 1 from "voice" where "teamId" = $1`, [team])).not.toHaveLength(0);
    } finally {
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
    }
  });

  it("finds no table but its memberships, languages, invites and requests letting go of a team", async () => {
    // Any other would lose its rows with the team rather than refuse the delete: add it to
    // deleteTeam's SETUP if it is setup, or give it a plain reference if it is work.
    const rows = await systemRows<{ table: string }>(
      `select conrelid::regclass::text as "table" from pg_constraint
        where contype = 'f' and confrelid = '"team"'::regclass and confdeltype <> 'a'
        order by 1`,
    );
    expect(rows.map((row) => row.table)).toEqual(["invite", "team_language", "team_member", "team_request"]);
  });

  it("answers 404 for no such team", async () => {
    await expect(deleteTeam(randomUUID(), actor)).rejects.toMatchObject({ status: 404 });
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
  it("counts only the live takes of each language's privileged team", async () => {
    const file = `gossip/${tag}count.mp3`;
    const row = (version: number, current: boolean, lang: string, team?: string) =>
      asSystem.query(
        `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "teamId")
         values ('quests', $3, $1, 'g:count', $2, $4, 'generated', 1, coalesce($5::uuid, team_of_lang($3)))`,
        [file, version, lang, current, team ?? null],
      );
    const second = await newTeamIn("deDE", false);
    made.push(second);
    const before = await liveTakeCounts();
    try {
      await row(1, false, "deDE");
      await row(2, true, "deDE");
      await row(1, true, "frFR");
      await row(3, true, "deDE", second);
      const after = await liveTakeCounts();
      expect(after.get("deDE")).toBe((before.get("deDE") ?? 0) + 1);
      expect(after.get("frFR")).toBe((before.get("frFR") ?? 0) + 1);
    } finally {
      await asSystem.query(`delete from "take" where "file" = $1`, [file]);
    }
  });
});

describe("foundLangTeam", () => {
  // As addLanguage calls it: the app role's own transaction, no team set.
  // A code no migration made a team for, so the cleanup deletes only what this made.
  it("gives a language a team slugged by its code, with English's roster and plain packs", async () => {
    await inTransaction((client) => foundLangTeam(client, "zzZZ"));
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
    await inTransaction((client) => foundLangTeam(client, "zzZZ"));
    const rows = await systemRows<{ id: string; slug: string }>(
      `select t."id", t."slug" from "team" t where t."id" = team_of_lang('zzZZ')`,
    );
    made.push(rows[0].id);
    expect(rows[0].id).not.toBe(squatter);
    expect(rows[0].slug).toBe("zzzz-2");
  });

  it("leaves the caller's transaction acting as the team it acted as", async () => {
    const team = await withTeam(was, async (client) => {
      await foundLangTeam(client, "zzZZ");
      return (await client.query<{ team: string }>(`select current_setting('spoken.team', true) as "team"`)).rows[0].team;
    });
    made.push((await systemRows<{ id: string }>(`select team_of_lang('zzZZ') as "id"`))[0].id);
    expect(team).toBe(was);
  });
});

describe("createTeamWithLangs", () => {
  it("says what already moved when granting the admin is refused in a later language", async () => {
    const first = await uniqueLang();
    const second = await uniqueLang();
    const holder = await newTeamIn(first, true, "cwl-first");
    const other = await newTeamIn(second, true, "cwl-second");
    const secondary = await newTeamIn(second, false, "cwl-secondary");
    // The admin already works on `second` in another team, so the grant there is refused.
    await asSystem.query(`insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'edit')`, [
      secondary, actor, second,
    ]);
    try {
      await expect(
        createTeamWithLangs(
          { slug: `t-${tag}`, name: `Team ${tag}`, adminEmail: `${actor}@example.invalid`, langs: [first, second] },
          actor,
        ),
      ).rejects.toSatisfy(
        (error: unknown) => error instanceof TeamError && error.status === 409 && error.message.startsWith(`moved ${first}, ${second}; `),
      );
    } finally {
      const [made_] = await systemRows<{ id: string }>(`select "id" from "team" where "slug" = $1`, [`t-${tag}`]);
      await asSystem.query(`delete from "activity" where "lang" = any($1)`, [[first, second]]);
      for (const team of [made_?.id, holder, other, secondary]) if (team) await dropTeam(team);
      await dropLang(first);
      await dropLang(second);
      forgetTeams();
    }
  });
});

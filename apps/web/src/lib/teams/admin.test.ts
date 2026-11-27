/** Needs DATABASE_URL and migrations through 0091 applied. */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, inTransaction, withTeam } from "@/lib/db";

import { addToLanguage, createTeam, createTeamWithLangs, listTeams, renameTeam, TeamError } from "./admin";
import { forgetTeams, foundLangTeam, teamsOf } from "./store";
import { asSystem, dropLang, dropTeam, newTeamIn, plainTeam, systemRows, testUser, uniqueLang } from "./testing";

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
  was = await plainTeam("deDE");
});

afterEach(async () => {
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

describe("a team's foreign keys", () => {
  it("finds no table but its memberships, languages, invites and requests letting go of a team", async () => {
    // Any other would lose its rows with the team unseen: list it in delete.ts DELETED, where
    // delete.test.ts checks every table with a team's rows is.
    const rows = await systemRows<{ table: string }>(
      `select conrelid::regclass::text as "table" from pg_constraint
        where contype = 'f' and confrelid = '"team"'::regclass and confdeltype <> 'a'
        order by 1`,
    );
    expect(rows.map((row) => row.table)).toEqual(["invite", "team_language", "team_member", "team_request"]);
  });
});

describe("addToLanguage", () => {
  it("adds the team beside the language's team, which keeps its plain packs, and logs it under the new team", async () => {
    const team = await newTeam();
    await addToLanguage("deDE", team, actor);
    expect((await teamsOf("deDE")).map((each) => each.id)).toEqual([was, team]);
    expect(
      await systemRows(`select "teamId", "packName" from "team_language" where "lang" = 'deDE' order by "packName"`),
    ).toEqual([
      { teamId: was, packName: "plain" },
      { teamId: team, packName: "slug" },
    ]);
    const log = await systemRows<{ teamId: string; detail: { slug: string; from: string | null } }>(
      `select "teamId", "detail" from "activity" where "kind" = 'team.joined_language' and "actorId" = $1`,
      [actor],
    );
    expect(log).toEqual([{ teamId: team, detail: { slug: `t-${tag}`, from: null } }]);
  });

  it("adds a team to English, and refuses a language the team already voices", async () => {
    const team = await newTeam();
    await addToLanguage("enUS", team, actor);
    await expect(addToLanguage("enUS", team, actor)).rejects.toSatisfy(refused(409));
    await addToLanguage("deDE", team, actor);
    await expect(addToLanguage("deDE", team, actor)).rejects.toSatisfy(refused(409));
  });

  it("switches on a language with no team; a team slugged by its code gets plain packs", async () => {
    const lang = await uniqueLang();
    const team = await newTeam(lang.toLowerCase());
    try {
      await addToLanguage(lang, team, actor);
      expect(await systemRows(`select "enabled" from "language" where "code" = $1`, [lang])).toEqual([{ enabled: true }]);
      expect(await systemRows(`select "packName" from "team_language" where "lang" = $1`, [lang])).toEqual([
        { packName: "plain" },
      ]);
    } finally {
      await asSystem.query(`delete from "activity" where "lang" = $1`, [lang]);
      await asSystem.query(`delete from "team_language" where "lang" = $1`, [lang]);
      await dropLang(lang);
    }
  });
});

describe("listTeams", () => {
  it("lists a team with every language it voices", async () => {
    const team = await newTeam();
    await addToLanguage("deDE", team, actor);
    const found = (await listTeams()).find((t) => t.id === team);
    expect(found).toMatchObject({ slug: `t-${tag}`, langs: ["deDE"], members: [] });
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
  it("says which languages it already joined when granting the admin is refused in a later one", async () => {
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
        (error: unknown) => error instanceof TeamError && error.status === 409 && error.message.startsWith(`joined ${first}, ${second}; `),
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

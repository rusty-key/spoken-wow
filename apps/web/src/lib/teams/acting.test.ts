/** Needs DATABASE_URL and migrations through 0113 applied. */
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordActivity } from "@/lib/activity/store";
import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import { actingTeams, asActor, asTeams, memberTeams, teamIn } from "./acting";
import { actsAsSecondTeam, byTeam, forgetTeams, ownerOrAll, privilegedOf, queryAs, readAs, teamOf } from "./store";
import { asSystem, dropTeam, systemRows, testUser } from "./testing";

const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let lang: Lang;
let tag: string;
let teamA: string;
let teamB: string;
let u: Awaited<ReturnType<typeof testUser>>;
let v: Awaited<ReturnType<typeof testUser>>;

async function newTeam(name: string, privileged: boolean): Promise<string> {
  const [row] = await systemRows<{ id: string }>(`select new_team($1, $1) as "id"`, [`${name}-${tag}`]);
  await asSystem.query(`insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, $3)`, [
    row.id, lang, privileged,
  ]);
  forgetTeams();
  return row.id;
}

const GRANT = `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, $4)`;

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  lang = `xq${CAPITALS[randomInt(26)]}${CAPITALS[randomInt(26)]}` as Lang;
  u = await testUser("test-acting-u");
  v = await testUser("test-acting-v");
  teamA = await newTeam("acting-a", true);
  teamB = await newTeam("acting-b", false);
  await asSystem.query(GRANT, [teamB, u.id, lang, "regenerate"]);
  await asSystem.query(GRANT, [teamA, v.id, lang, "regenerate"]);
});

afterEach(async () => {
  for (const team of [teamA, teamB]) {
    await asSystem.query(`delete from "take" where "teamId" = $1`, [team]);
    await asSystem.query(`delete from "activity" where "teamId" = $1`, [team]);
    await dropTeam(team);
  }
  await u.cleanup();
  await v.cleanup();
  forgetTeams();
});

afterAll(closeDb);

describe("memberTeams and teamIn", () => {
  it("names the team a person works in for each language", async () => {
    expect(await memberTeams(u.id)).toEqual(new Map([[lang, teamB]]));
    expect(await teamIn(u.id, lang)).toBe(teamB);
    expect(await teamIn(u.id, "deDE")).toBeNull();
  });
});

describe("actingTeams", () => {
  it("is empty outside any scope and request", async () => {
    expect(await actingTeams()).toEqual(new Map());
  });

  it("is the scope's map inside asTeams", async () => {
    const teams = new Map([[lang, teamB]]);
    expect(await asTeams(teams, () => actingTeams())).toBe(teams);
  });
});

describe("the owner a person works as", () => {
  it("is the privileged team outside any scope, and the person's own team inside one", async () => {
    expect(await ownerOrAll(lang)).toBe(teamA);
    expect(await asActor(u.id, () => ownerOrAll(lang))).toBe(teamB);
    expect(await asActor(v.id, () => ownerOrAll(lang))).toBe(teamA);
  });

  it("keeps privilegedOf on the privileged team and says when the owner differs", async () => {
    expect(await asActor(u.id, () => privilegedOf(lang))).toBe(teamA);
    expect(await asActor(u.id, () => actsAsSecondTeam(lang))).toBe(true);
    expect(await asActor(v.id, () => actsAsSecondTeam(lang))).toBe(false);
    expect(await actsAsSecondTeam(lang)).toBe(false);
  });

  it("writes a second team member's take under their team, which the privileged team cannot read", async () => {
    const file = `acting-${tag}.mp3`;
    await asActor(u.id, () =>
      queryAs(
        lang,
        `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes")
         values ('quests', $1, $2, 'g:acting', 1, true, 'generated', 1)`,
        [lang, file],
      ),
    );
    expect(await systemRows(`select "teamId" from "take" where "file" = $1`, [file])).toEqual([{ teamId: teamB }]);
    const seen = await asActor(v.id, () => readAs(lang, `select 1 from "take" where "file" = $1`, [file]));
    expect(seen).toEqual([]);
  });

  it("files a second team member's activity under their team", async () => {
    const subject = `acting-${tag}`;
    await asActor(u.id, () =>
      recordActivity({ kind: "ignore.set", lang, actorId: u.id, subject, detail: {} }),
    );
    expect(await systemRows(`select "teamId" from "activity" where "subject" = $1`, [subject])).toEqual([
      { teamId: teamB },
    ]);
  });

  it("groups the language under the person's team and others under their privileged team", async () => {
    const grouped = await asActor(u.id, () => byTeam([lang, "deDE"]));
    const german = await teamOf("deDE");
    expect(grouped.get(teamB)).toEqual([lang]);
    expect(grouped.get(german)).toEqual(["deDE"]);
    expect(grouped.has(teamA)).toBe(false);
  });
});

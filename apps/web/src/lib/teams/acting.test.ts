/** Needs DATABASE_URL and migrations through 0113 applied. */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { recordActivity } from "@/lib/activity/store";
import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import { actingTeams, asActor, asTeams, memberTeams, teamIn } from "./acting";
import { ALL_TEAMS } from "@/lib/db";

import { byTeam, forgetTeams, NoTeamError, ownerOrAll, plainTeamOf, queryAs, readAs, teamOf } from "./store";
import { addMember, asSystem, dropTeam, newTeamIn, randomLang, systemRows, testUser } from "./testing";

let lang: Lang;
let tag: string;
let teamA: string;
let teamB: string;
let u: Awaited<ReturnType<typeof testUser>>;
let v: Awaited<ReturnType<typeof testUser>>;

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  lang = randomLang();
  u = await testUser("test-acting-u");
  v = await testUser("test-acting-v");
  teamA = await newTeamIn(lang, true, "acting-a");
  teamB = await newTeamIn(lang, false, "acting-b");
  await addMember(teamB, u.id, lang, "regenerate");
  await addMember(teamA, v.id, lang, "regenerate");
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
  it("is no team outside any scope, and the person's own team inside one", async () => {
    expect(await ownerOrAll(lang)).toBe(ALL_TEAMS);
    await expect(teamOf(lang)).rejects.toBeInstanceOf(NoTeamError);
    // A reader outside every team reads as the first, as the Explorer shows them.
    expect(await readAs(lang, `select 1 as "one"`)).toEqual([{ one: 1 }]);
    expect(await asActor(u.id, () => ownerOrAll(lang))).toBe(teamB);
    expect(await asActor(v.id, () => ownerOrAll(lang))).toBe(teamA);
  });

  it("is a language's one team, whoever is acting", async () => {
    const single = randomLang();
    const team = await newTeamIn(single, false, "acting-single");
    try {
      expect(await ownerOrAll(single)).toBe(team);
      expect(await asActor(u.id, () => ownerOrAll(single))).toBe(team);
    } finally {
      await dropTeam(team);
    }
  });

  it("keeps plainTeamOf on the team with plain packs, whoever is acting", async () => {
    expect(await asActor(u.id, () => plainTeamOf(lang))).toBe(teamA);
  });

  it("writes a member's take under their team, which another team of the language cannot read", async () => {
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

  it("files a member's activity under their team", async () => {
    const subject = `acting-${tag}`;
    await asActor(u.id, () =>
      recordActivity({ kind: "ignore.set", lang, actorId: u.id, subject, detail: {} }),
    );
    expect(await systemRows(`select "teamId" from "activity" where "subject" = $1`, [subject])).toEqual([
      { teamId: teamB },
    ]);
  });

  it("groups the language under the person's team and others under their one team", async () => {
    const grouped = await asActor(u.id, () => byTeam([lang, "deDE"]));
    const german = await teamOf("deDE");
    expect(grouped.get(teamB)).toEqual([lang]);
    expect(grouped.get(german)).toEqual(["deDE"]);
    expect(grouped.has(teamA)).toBe(false);
  });
});

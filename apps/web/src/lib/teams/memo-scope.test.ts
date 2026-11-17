/** Needs DATABASE_URL and migrations through 0113 applied. */
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { readOverrides, writeOverride } from "@/lib/quests/overrides";
import { forgetReferences, pinnedVoices } from "@/lib/voices/references";

import { asActor } from "./acting";
import { forgetTeams } from "./store";
import { asSystem, dropTeam, systemRows, testUser } from "./testing";

const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GRANT = `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, $4)`;

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

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  lang = `xq${CAPITALS[randomInt(26)]}${CAPITALS[randomInt(26)]}` as Lang;
  u = await testUser("test-memo-u");
  v = await testUser("test-memo-v");
  teamA = await newTeam("memo-a", true);
  teamB = await newTeam("memo-b", false);
  await asSystem.query(GRANT, [teamB, u.id, lang, "regenerate"]);
  await asSystem.query(GRANT, [teamA, v.id, lang, "regenerate"]);
});

afterEach(async () => {
  for (const team of [teamA, teamB]) {
    await asSystem.query(`delete from "fish_reference" where "teamId" = $1`, [team]);
    await asSystem.query(`delete from "line_override" where "teamId" = $1`, [team]);
    await asSystem.query(`delete from "activity" where "teamId" = $1`, [team]);
    await dropTeam(team);
  }
  await u.cleanup();
  await v.cleanup();
  forgetReferences(lang);
  forgetTeams();
});

afterAll(closeDb);

describe("memos of team data", () => {
  it("keeps one reference list per team", async () => {
    await asSystem.query(
      `insert into "fish_reference" ("teamId", "voice", "lang", "sample", "startSec", "endSec", "transcript", "clipHash", "pinned")
       values ($1, 'memo-voice', $2, 's', 0, 15, 't', 'h', true)`,
      [teamA, lang],
    );
    expect([...(await asActor(v.id, () => pinnedVoices(lang)))]).toEqual(["memo-voice"]);
    expect([...(await asActor(u.id, () => pinnedVoices(lang)))]).toEqual([]);
  });

  it("keeps one override map per team", async () => {
    const file = `memo-${tag}.mp3`;
    await asActor(u.id, () => writeOverride(lang, file, "g:memo", "second team text", u.id));
    expect((await asActor(v.id, () => readOverrides(lang))).has(file)).toBe(false);
    expect((await asActor(u.id, () => readOverrides(lang))).has(file)).toBe(true);
    expect((await asActor(v.id, () => readOverrides(lang))).has(file)).toBe(false);
  });
});

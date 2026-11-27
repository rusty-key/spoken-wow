/** Needs DATABASE_URL and migrations applied. */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asTeam } from "@/lib/teams/acting";
import { dropTeam, newTeamIn, unowned } from "@/lib/teams/testing";

import { loadBaseRoster, loadRoster } from "./roster-store";
import { isVoiceSlot } from "./slots";

const KEY = `t${Math.floor(Math.random() * 1e9)}`;

afterAll(async () => {
  await db().query(`delete from "race" where "key" = $1`, [KEY]);
  await closeDb();
});

describe("loadRoster", () => {
  it("reads the seeded roster", async () => {
    const roster = await loadRoster("enUS");
    expect(roster.voiceFor("orc", "male", "shady")).toBe("orc-male-shady");
    expect(roster.voiceFor("gameobject", null, null)).toBe("narrator-male");
    expect(roster.gendersOf("orc")).toEqual(["female", "male"]);
  });

  it("keeps one roster while nothing moves", async () => {
    expect(await loadRoster("enUS")).toBe(await loadRoster("enUS"));
  });

  it("reads English's roster for a language nobody owns", async () => {
    const italian = await unowned("itIT");
    try {
      expect(await loadRoster("itIT")).toBe(await loadRoster("enUS"));
      expect(await isVoiceSlot("orc-male-shady", "itIT")).toBe(true);
    } finally {
      await italian.restore();
    }
  });

  it("reads English's first roster for a language nobody owns while several teams voice English", async () => {
    const english = await loadRoster("enUS");
    const [team, italian] = [await newTeamIn("enUS", false), await unowned("itIT")];
    try {
      expect(await loadRoster("itIT")).toBe(english);
      expect(await asTeam("enUS", team, loadBaseRoster)).toBe(english);
      expect(await asTeam("enUS", team, () => loadRoster("enUS"))).not.toBe(english);
    } finally {
      await italian.restore();
      await dropTeam(team);
    }
  });

  it("sees a type added behind its back", async () => {
    await loadRoster("enUS");
    await db().query(`insert into "race" ("key") values ($1)`, [KEY]);
    expect((await loadRoster("enUS")).hasRace(KEY)).toBe(true);
  });
});

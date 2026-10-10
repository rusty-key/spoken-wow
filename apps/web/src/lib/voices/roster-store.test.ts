/** Needs DATABASE_URL and migrations applied. */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { loadRoster } from "./roster-store";

const KEY = `t${Math.floor(Math.random() * 1e9)}`;

afterAll(async () => {
  await db().query(`delete from "race" where "key" = $1`, [KEY]);
  await closeDb();
});

describe("loadRoster", () => {
  it("reads the seeded roster", async () => {
    const roster = await loadRoster();
    expect(roster.voiceFor("orc", "male", "shady")).toBe("orc-male-shady");
    expect(roster.voiceFor("gameobject", null, null)).toBe("narrator-male");
    expect(roster.gendersOf("orc")).toEqual(["female", "male"]);
  });

  it("keeps one roster while nothing moves", async () => {
    expect(await loadRoster()).toBe(await loadRoster());
  });

  it("sees a type added behind its back", async () => {
    await loadRoster();
    await db().query(`insert into "race" ("key") values ($1)`, [KEY]);
    expect((await loadRoster()).hasRace(KEY)).toBe(true);
  });
});

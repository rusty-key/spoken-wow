/** Needs DATABASE_URL and migrations applied. */
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { invalidateRoster, loadRoster } from "./roster-store";

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

  it("sees a new type once invalidated", async () => {
    await loadRoster();
    await db().query(`insert into "race" ("key") values ($1)`, [KEY]);
    invalidateRoster();
    expect((await loadRoster()).hasRace(KEY)).toBe(true);
  });
});

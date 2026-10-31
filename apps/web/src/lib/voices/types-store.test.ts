/**
 * The types are every team's and each team keeps its own roster over them: an edit of the
 * types reaches every team's roster, a voice assignment only its own.
 *
 * Needs DATABASE_URL and migrations applied.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { asSystem, ownTeam } from "@/lib/teams/testing";

import { loadRoster } from "./roster-store";
import { addFlavor, addType, assignVoice, deleteFlavor, deleteType } from "./types-store";

const KEY = `t${Math.floor(Math.random() * 1e9)}`;

let german: Awaited<ReturnType<typeof ownTeam>>;

beforeAll(async () => {
  german = await ownTeam("deDE");
});

afterEach(async () => {
  await asSystem.query(`delete from "voice_assignment" where "race" = $1`, [KEY]);
  await asSystem.query(`delete from "flavor" where "race" = $1`, [KEY]);
  await asSystem.query(`delete from "gender" where "race" = $1`, [KEY]);
  await asSystem.query(`delete from "race" where "key" = $1`, [KEY]);
  await asSystem.query(`delete from "voice" where "name" = $1 or "name" like $2`, [KEY, `${KEY}-%`]);
  await asSystem.query(`delete from "activity" where "subject" = $1`, [KEY]);
});

afterAll(async () => {
  await german.restore();
  await closeDb();
});

async function teamsWith(voice: string): Promise<string[]> {
  const { rows } = await asSystem.query<{ teamId: string }>(
    `select a."teamId" from "voice_assignment" a join "voice" v on v."teamId" = a."teamId" and v."name" = a."voice"
      where a."voice" = $1 order by 1`,
    [voice],
  );
  return rows.map((row) => row.teamId);
}

describe("types across teams", () => {
  it("adds a type to every team's roster", async () => {
    await addType(KEY, ["male"]);
    expect((await loadRoster("enUS")).voiceFor(KEY, "male", null)).toBe(`${KEY}-male`);
    expect((await loadRoster("deDE")).voiceFor(KEY, "male", null)).toBe(`${KEY}-male`);
    expect(await teamsWith(`${KEY}-male`)).toContain(german.team);
  });

  it("adds and deletes a flavor in every team's roster", async () => {
    await addType(KEY, ["male"]);
    await addFlavor(KEY, "male", "old");
    for (const lang of ["enUS", "deDE"] as const) {
      const roster = await loadRoster(lang);
      expect(roster.voiceFor(KEY, "male", "old")).toBe(`${KEY}-male-old`);
      expect(roster.voiceFor(KEY, "male", null)).toBeNull();
    }
    await deleteFlavor(KEY, "male", "old");
    expect(await teamsWith(`${KEY}-male-old`)).toEqual([]);
  });

  it("deletes a type from every team's roster", async () => {
    await addType(KEY, []);
    await deleteType(KEY);
    expect(await teamsWith(KEY)).toEqual([]);
    expect((await loadRoster("deDE")).hasRace(KEY)).toBe(false);
  });

  it("points one team's combination at a voice without moving another's", async () => {
    await addType(KEY, ["male"]);
    await assignVoice(KEY, "male", null, "narrator-male", "deDE");
    expect((await loadRoster("deDE")).voiceFor(KEY, "male", null)).toBe("narrator-male");
    expect((await loadRoster("enUS")).voiceFor(KEY, "male", null)).toBe(`${KEY}-male`);
  });
});

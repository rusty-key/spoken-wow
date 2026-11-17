/** Needs DATABASE_URL and migrations through 0113 applied. */
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import { forgetTeams, freshOwners, ownerOrAll } from "./store";
import { asSystem, dropTeam, systemRows } from "./testing";

const acting = vi.hoisted(() => ({ calls: 0, teams: new Map<string, string>() }));

vi.mock("./acting", () => ({
  actingTeams: async () => {
    acting.calls += 1;
    return acting.teams;
  },
}));

const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let lang: Lang;
let tag: string;
let teamA: string;
let teamB: string;

async function newTeam(name: string, privileged: boolean): Promise<string> {
  const [row] = await systemRows<{ id: string }>(`select new_team($1, $1) as "id"`, [`${name}-${tag}`]);
  await asSystem.query(`insert into "team_language" ("teamId", "lang", "privileged") values ($1, $2, $3)`, [
    row.id, lang, privileged,
  ]);
  return row.id;
}

beforeEach(async () => {
  tag = randomUUID().slice(0, 8);
  lang = `xq${CAPITALS[randomInt(26)]}${CAPITALS[randomInt(26)]}` as Lang;
  teamA = await newTeam("overlay-a", true);
  teamB = await newTeam("overlay-b", false);
  forgetTeams();
  acting.teams = new Map([[lang, teamB]]);
  acting.calls = 0;
});

afterEach(async () => {
  for (const team of [teamA, teamB]) await dropTeam(team);
  forgetTeams();
});

afterAll(closeDb);

describe("the acting team's overlay", () => {
  it("never reads the acting teams for languages with one team", async () => {
    await ownerOrAll("deDE");
    await freshOwners(["deDE", "frFR"]);
    expect(acting.calls).toBe(0);
  });

  it("reads them once for a language with a second team", async () => {
    expect(await ownerOrAll(lang)).toBe(teamB);
    expect(acting.calls).toBe(1);
  });
});

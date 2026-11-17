/** Needs DATABASE_URL and migrations through 0113 applied. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import { forgetTeams, freshOwners, ownerOrAll } from "./store";
import { dropTeam, newTeamIn, randomLang } from "./testing";

const acting = vi.hoisted(() => ({ calls: 0, teams: new Map<string, string>() }));

vi.mock("./acting", () => ({
  actingTeams: async () => {
    acting.calls += 1;
    return acting.teams;
  },
}));

let lang: Lang;
let teamA: string;
let teamB: string;

beforeEach(async () => {
  lang = randomLang();
  teamA = await newTeamIn(lang, true, "overlay-a");
  teamB = await newTeamIn(lang, false, "overlay-b");
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

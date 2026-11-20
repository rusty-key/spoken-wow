/**
 * actingTeams inside a request: the session's person's teams, unless asTeams names others.
 *
 * Needs DATABASE_URL and migrations through 0113 applied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));

// A request: headers() answers rather than refusing as it does outside one.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/session", () => ({ currentSession: async () => session.current }));

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import { actingTeams, asTeams } from "./acting";
import { forgetTeams } from "./store";
import { addMember, dropTeam, newTeamIn, randomLang, testUser } from "./testing";

let lang: Lang;
let teamA: string;
let teamB: string;
let u: Awaited<ReturnType<typeof testUser>>;

beforeEach(async () => {
  lang = randomLang();
  u = await testUser("test-acting-session");
  teamA = await newTeamIn(lang, true, "session-a");
  teamB = await newTeamIn(lang, false, "session-b");
  await addMember(teamB, u.id, lang, "regenerate");
});

afterEach(async () => {
  session.current = null;
  for (const team of [teamA, teamB]) await dropTeam(team);
  await u.cleanup();
  forgetTeams();
});

afterAll(closeDb);

describe("actingTeams in a request", () => {
  it("is the teams the session's person works in", async () => {
    session.current = { user: { id: u.id } };
    expect(await actingTeams()).toEqual(new Map([[lang, teamB]]));
  });

  it("is empty with no session", async () => {
    expect(await actingTeams()).toEqual(new Map());
  });

  it("is asTeams' map over the session", async () => {
    session.current = { user: { id: u.id } };
    const teams = new Map([[lang, teamA]]);
    expect(await asTeams(teams, () => actingTeams())).toBe(teams);
  });
});

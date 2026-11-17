/**
 * actingTeams inside a request: the session's person's teams, unless asTeams names others.
 *
 * Needs DATABASE_URL and migrations through 0113 applied.
 */
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));

// A request: headers() answers rather than refusing as it does outside one.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/session", () => ({ currentSession: async () => session.current }));

import { closeDb } from "@/lib/db";
import type { Lang } from "@/lib/lang";

import { actingTeams, asTeams } from "./acting";
import { forgetTeams } from "./store";
import { asSystem, dropTeam, systemRows, testUser } from "./testing";

const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

let lang: Lang;
let tag: string;
let teamA: string;
let teamB: string;
let u: Awaited<ReturnType<typeof testUser>>;

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
  u = await testUser("test-acting-session");
  teamA = await newTeam("session-a", true);
  teamB = await newTeam("session-b", false);
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability") values ($1, $2, $3, 'regenerate')`,
    [teamB, u.id, lang],
  );
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

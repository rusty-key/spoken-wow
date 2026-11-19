/** Needs DATABASE_URL and migrations through 0121; the session is mocked, and no job is spawned. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, newTeamIn, ownTeam, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "", role: "member" }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: who.role } }),
}));

const droplet = vi.hoisted(() => ({ startDropletRun: vi.fn() }));
vi.mock("@/lib/releases/droplet", async (original) => ({
  ...(await original<typeof import("@/lib/releases/droplet")>()),
  ...droplet,
}));

import { POST } from "./route";

let user: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
let second = "";

const delist = (body: unknown) => POST(new Request("http://x/api/releases/delist", { method: "POST", body: JSON.stringify(body) }));

beforeAll(async () => {
  user = await testUser("release-delist-route");
  fr = await ownTeam("frFR");
  second = await newTeamIn("frFR", false, "delist-route");
  forgetTeams();
});

beforeEach(() => {
  vi.stubEnv("SPOKEN_RELEASE_ENV", join(mkdtempSync(join(tmpdir(), "delist-route-")), "release.env"));
  droplet.startDropletRun.mockReset().mockResolvedValue(undefined);
  who.id = user.id;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await asSystem.query(`delete from "release_run"`);
  await asSystem.query(`delete from "activity" where "kind" like 'release.%'`);
});

afterAll(async () => {
  await asSystem.query(`delete from "activity" where "teamId" = $1`, [second]);
  await dropTeam(second);
  await fr.restore();
  await user.cleanup();
  forgetTeams();
  await closeDb();
});

describe("delisting a team's pack", () => {
  it("is 403 to anyone but a site owner", async () => {
    who.role = "member";
    expect((await delist({ team: second, lang: "frFR", section: "places" })).status).toBe(403);
  });

  it("queues the delisting for a site owner", async () => {
    who.role = "admin";
    const response = await delist({ team: second, lang: "frFR", section: "places" });
    expect(response.status).toBe(202);
    expect((await response.json()).run).toMatchObject({ kind: "delist", section: "places", lang: "frFR" });
    expect(droplet.startDropletRun).toHaveBeenCalledTimes(1);
  });

  it("is 400 for a bad section or a null body, and 409 for an official team's pack", async () => {
    who.role = "admin";
    expect((await delist(null)).status).toBe(400);
    expect((await delist({ team: second, lang: "frFR", section: "voices" })).status).toBe(400);
    expect((await delist({ team: fr.team, lang: "frFR", section: "places" })).status).toBe(409);
  });
});

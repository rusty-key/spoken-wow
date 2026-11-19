/** Needs DATABASE_URL and migrations through 0121; the session is mocked, and the bytes are not read. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, newTeamIn, ownTeam, systemRows, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "", role: "member" }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: who.role } }),
}));
// Which take's bytes it would serve, rather than the bytes.
vi.mock("@/lib/takes/serve", () => ({ serveTake: async (_request: Request, bytes: unknown) => Response.json(bytes) }));

import { GET } from "./route";

const FILE = "release-take-test";
let owner: Awaited<ReturnType<typeof testUser>>;
let member: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
let second = "";
let runId = "";

async function take(team: string, version: number, current: boolean, archiveFile: string) {
  await asSystem.query(
    `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes", "archiveFile", "teamId")
     values ('places', 'frFR', $1, 'z:release-take-test', $2, $3, 'generated', 1, $4, $5)`,
    [FILE, version, current, archiveFile, team],
  );
}

const fetchTake = (id: string, query: Record<string, string>) =>
  GET(new Request(`http://x/api/releases/${id}/take?${new URLSearchParams(query)}`), { params: Promise.resolve({ id }) });

beforeAll(async () => {
  owner = await testUser("release-take-owner");
  member = await testUser("release-take-member");
  fr = await ownTeam("frFR");
  second = await newTeamIn("frFR", false, "release-take");
  // An admin of the language's own team: a member of a team other than the release's.
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedBy") values ($1, $2, 'frFR', 'admin', $2)`,
    [fr.team, member.id],
  );
  await take(second, 2, false, "v2-second.mp3");
  await take(second, 3, true, "v3-second.mp3");
  await take(fr.team, 2, true, "v2-own.mp3");
  [{ id: runId }] = await systemRows<{ id: string }>(
    `insert into "release_run" ("teamId", "section", "lang", "state", "stage", "staged", "takes", "version")
     values ($1, 'places', 'frFR', 'awaiting_review', true, '{"packs":{},"languages":{}}', $2, '1.0.0') returning "id"`,
    [second, JSON.stringify({ [FILE]: { version: 2, sha256: null } })],
  );
  forgetTeams();
});

afterEach(() => {
  who.id = "";
  who.role = "member";
});

afterAll(async () => {
  await asSystem.query(`delete from "release_run" where "id" = $1`, [runId]);
  await asSystem.query(`delete from "take" where "file" = $1`, [FILE]);
  await asSystem.query(`delete from "team_member" where "userId" = $1`, [member.id]);
  await dropTeam(second);
  await fr.restore();
  await owner.cleanup();
  await member.cleanup();
  forgetTeams();
  await closeDb();
});

describe("a staged release's take", () => {
  it("plays for a site owner the release's team's version asked for, not the live one or another team's", async () => {
    who.id = owner.id;
    who.role = "admin";
    const response = await fetchTake(runId, { file: FILE, version: "2" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("v2-second.mp3");
  });

  it("is refused to a member of another team, who could not hear the team's history", async () => {
    who.id = member.id;
    const response = await fetchTake(runId, { file: FILE, version: "2" });
    expect(response.status).toBe(403);
  });

  it("is 400 without a version, and 404 for no such release", async () => {
    who.id = owner.id;
    who.role = "admin";
    expect((await fetchTake(runId, { file: FILE })).status).toBe(400);
    expect((await fetchTake("00000000-0000-0000-0000-000000000000", { file: FILE, version: "2" })).status).toBe(404);
  });
});

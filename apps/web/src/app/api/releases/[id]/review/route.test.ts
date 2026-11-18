/** Needs DATABASE_URL and migrations through 0121; the session is mocked, and no job or email goes out. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, newTeamIn, ownTeam, systemRows, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "", role: "member" }));
vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: who.role } }),
}));

const droplet = vi.hoisted(() => ({ startDropletRun: vi.fn() }));
vi.mock("@/lib/releases/droplet", async (original) => ({
  ...(await original<typeof import("@/lib/releases/droplet")>()),
  ...droplet,
}));
vi.mock("@/lib/email", () => ({ sendEmail: async () => true }));

import { POST } from "./route";

let teamAdmin: Awaited<ReturnType<typeof testUser>>;
let owner: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
let second = "";

const review = (id: string, body: unknown) =>
  POST(new Request(`http://x/api/releases/${id}/review`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const as = (user: { id: string }, role = "member") => {
  who.id = user.id;
  who.role = role;
};

async function waiting(): Promise<string> {
  const [{ id }] = await systemRows<{ id: string }>(
    `insert into "release_run" ("teamId", "section", "lang", "state", "requestedBy", "stage", "staged", "version")
     values ($1, 'places', 'frFR', 'awaiting_review', $2, true, '{"packs":{},"languages":{}}', '1.0.0') returning "id"`,
    [second, teamAdmin.id],
  );
  return id;
}
const stateOf = async (id: string) =>
  (await systemRows<{ state: string }>(`select "state" from "release_run" where "id" = $1`, [id]))[0].state;

beforeAll(async () => {
  teamAdmin = await testUser("release-review-route-admin");
  owner = await testUser("release-review-route-owner");
  fr = await ownTeam("frFR");
  second = await newTeamIn("frFR", false, "review-route");
  await asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedBy") values ($1, $2, 'frFR', 'admin', $2)`,
    [second, teamAdmin.id],
  );
  forgetTeams();
});

beforeEach(() => {
  vi.stubEnv("SPOKEN_RELEASE_ENV", join(mkdtempSync(join(tmpdir(), "review-route-")), "release.env"));
  droplet.startDropletRun.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await asSystem.query(`delete from "release_run" where "promotes" is not null`);
  await asSystem.query(`delete from "release_run"`);
  await asSystem.query(`delete from "activity" where "kind" like 'release.%'`);
});

afterAll(async () => {
  await asSystem.query(`delete from "team_member" where "userId" = $1`, [teamAdmin.id]);
  await dropTeam(second);
  await fr.restore();
  await teamAdmin.cleanup();
  await owner.cleanup();
  forgetTeams();
  await closeDb();
});

describe("reviewing a team's release", () => {
  it("is 403 to the team's own admin, who cannot approve their own version", async () => {
    const id = await waiting();
    as(teamAdmin);
    expect((await review(id, { action: "approve" })).status).toBe(403);
    expect(droplet.startDropletRun).not.toHaveBeenCalled();
  });

  it("approves for a site owner, answering with the promotion", async () => {
    const id = await waiting();
    as(owner, "admin");
    const response = await review(id, { action: "approve" });
    expect(response.status).toBe(202);
    expect((await response.json()).run).toMatchObject({ kind: "promote", state: "dispatching" });
  });

  it("is 400 for a rejection without a reason, or no action", async () => {
    const id = await waiting();
    as(owner, "admin");
    expect((await review(id, { action: "reject" })).status).toBe(400);
    expect((await review(id, { action: "reject", note: " " })).status).toBe(400);
    expect((await review(id, {})).status).toBe(400);
    expect(await stateOf(id)).toBe("awaiting_review");
    expect((await review(id, { action: "reject", note: "Too quiet." })).status).toBe(200);
    expect(await stateOf(id)).toBe("rejected");
  });

  it("is 409 for a superseded version, and 404 for no such run", async () => {
    const id = await waiting();
    await asSystem.query(`update "release_run" set "state" = 'superseded' where "id" = $1`, [id]);
    as(owner, "admin");
    expect((await review(id, { action: "approve" })).status).toBe(409);
    expect((await review("00000000-0000-0000-0000-000000000000", { action: "approve" })).status).toBe(404);
  });
});

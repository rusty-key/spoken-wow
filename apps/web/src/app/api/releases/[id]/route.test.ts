/** Needs DATABASE_URL and migrations through 0121; the session is mocked. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { startRun } from "@/lib/releases/store";
import { asTeam } from "@/lib/teams/acting";
import { forgetTeams } from "@/lib/teams/store";
import { asSystem, dropTeam, newTeamIn, ownTeam, systemRows, testUser } from "@/lib/teams/testing";

const who = vi.hoisted(() => ({ id: "", role: "member" }));

vi.mock("@/lib/session", () => ({
  currentSession: async () => ({ user: { id: who.id, role: who.role } }),
}));

import { DELETE } from "./route";

let presser: Awaited<ReturnType<typeof testUser>>;
let colleague: Awaited<ReturnType<typeof testUser>>;
let outsider: Awaited<ReturnType<typeof testUser>>;
let fr: Awaited<ReturnType<typeof ownTeam>>;
let de: Awaited<ReturnType<typeof ownTeam>>;
let other = "";

const admin = (team: string, userId: string, lang: string) =>
  asSystem.query(
    `insert into "team_member" ("teamId", "userId", "lang", "capability", "grantedBy") values ($1, $2, $3, 'admin', $2)`,
    [team, userId, lang],
  );

const cancel = (id: string, as: { id: string }, role = "member") => {
  who.id = as.id;
  who.role = role;
  return DELETE(new Request(`http://x/api/releases/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
};

const stateOf = async (id: string) =>
  (await systemRows<{ state: string; error: string | null }>(`select "state", "error" from "release_run" where "id" = $1`, [id]))[0];

beforeAll(async () => {
  presser = await testUser("test-release-cancel");
  colleague = await testUser("test-release-cancel-colleague");
  outsider = await testUser("test-release-cancel-outsider");
  fr = await ownTeam("frFR");
  de = await ownTeam("deDE");
  other = await newTeamIn("frFR", false, "release-cancel-other");
  forgetTeams();
  await admin(fr.team, presser.id, "frFR");
  await admin(fr.team, colleague.id, "frFR");
  await admin(other, outsider.id, "frFR");
});

afterEach(async () => {
  await asSystem.query(`delete from "release_run"`);
  await asSystem.query(`delete from "activity" where "kind" like 'release.%'`);
});

afterAll(async () => {
  await asSystem.query(`delete from "team_member" where "userId" = any($1)`, [[presser.id, colleague.id, outsider.id]]);
  await dropTeam(other);
  await de.restore();
  await fr.restore();
  await presser.cleanup();
  await colleague.cleanup();
  await outsider.cleanup();
  forgetTeams();
  await closeDb();
});

describe("cancelling a queued release", () => {
  async function queued() {
    const active = await startRun("quests", "deDE", presser.id);
    // As the presser's team: frFR has two, and the call runs in no request.
    const run = await asTeam("frFR", fr.team, () => startRun("places", "frFR", presser.id));
    expect(run.state).toBe("queued");
    return { active, run };
  }

  it("lets whoever pressed it cancel it", async () => {
    const { run } = await queued();
    const response = await cancel(run.id, presser);
    expect(response.status).toBe(200);
    expect(await stateOf(run.id)).toEqual({ state: "failed", error: "Cancelled" });
  });

  it("lets a site owner cancel it", async () => {
    const { run } = await queued();
    expect((await cancel(run.id, outsider, "admin")).status).toBe(200);
    expect((await stateOf(run.id)).state).toBe("failed");
  });

  it("is 404 to another team's admin, and 403 to a teammate who did not press it", async () => {
    const { run } = await queued();
    expect((await cancel(run.id, outsider)).status).toBe(404);
    expect((await cancel(run.id, colleague)).status).toBe(403);
    expect((await stateOf(run.id)).state).toBe("queued");
  });

  it("is 409 on a run that has started", async () => {
    const { active } = await queued();
    expect((await cancel(active.id, outsider, "admin")).status).toBe(409);
    expect((await stateOf(active.id)).state).toBe("dispatching");
  });

  it("is 404 for no such run", async () => {
    expect((await cancel("00000000-0000-0000-0000-000000000000", presser)).status).toBe(404);
    expect((await cancel("nope", presser)).status).toBe(404);
  });
});

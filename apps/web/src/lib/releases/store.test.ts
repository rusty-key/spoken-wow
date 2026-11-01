import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, ownTeam, systemRows, testUser } from "@/lib/teams/testing";

import { ReleaseBusyError, activeRun, recentRuns, startRun, updateRun } from "./store";

// Only this file touches release_run, and vitest.config runs files one at a time, so the
// one-active index cannot be tripped by another suite.
describe("release runs", () => {
  let user: Awaited<ReturnType<typeof testUser>>;
  let fr: Awaited<ReturnType<typeof ownTeam>>;
  let de: Awaited<ReturnType<typeof ownTeam>>;

  beforeAll(async () => {
    user = await testUser("release-user");
    fr = await ownTeam("frFR");
    de = await ownTeam("deDE");
  });

  afterEach(async () => {
    await asSystem.query(`delete from "release_run"`);
    await asSystem.query(`delete from "activity" where "kind" like 'release.%'`);
  });

  afterAll(async () => {
    await de.restore();
    await fr.restore();
    await user.cleanup();
    await closeDb();
  });

  it("refuses a second run while one is active, naming the first even when it is another team's", async () => {
    const first = await startRun("quests", "frFR", user.id);
    expect(first.state).toBe("dispatching");
    const error = await startRun("places", "deDE", user.id).catch((e) => e);
    expect(error).toBeInstanceOf(ReleaseBusyError);
    expect((error as ReleaseBusyError).active).toEqual({ section: "quests", lang: "frFR" });
    expect((await activeRun())?.id).toBe(first.id);
  });

  it("starts again once the active run is done", async () => {
    const first = await startRun("quests", "frFR", user.id);
    await updateRun(first.id, { state: "done" });
    expect(await activeRun()).toBeNull();
    const second = await startRun("places", "deDE", user.id);
    expect(second.id).not.toBe(first.id);
  });

  it("keeps a run to its own language's team", async () => {
    await startRun("quests", "frFR", user.id);
    expect(await recentRuns("deDE", 10)).toEqual([]);
    expect(await recentRuns("frFR", 10)).toHaveLength(1);
  });

  it("records activity for the start and, once, for the finish", async () => {
    const run = await startRun("readables", "frFR", user.id);
    await updateRun(run.id, { state: "running", step: "build" });
    await updateRun(run.id, { state: "failed", error: "boom" });
    const settled = await updateRun(run.id, { state: "failed" });
    expect(settled.finishedAt).not.toBeNull();
    const rows = await systemRows<{ kind: string; teamId: string; detail: unknown }>(
      `select "kind", "teamId", "detail" from "activity" where "kind" like 'release.%' order by "id"`,
    );
    expect(rows.map((r) => r.kind)).toEqual(["release.started", "release.finished"]);
    expect(rows[0].detail).toEqual({ section: "readables" });
    expect(rows[1].detail).toEqual({ section: "readables", state: "failed" });
    expect(rows.every((r) => r.teamId === fr.team)).toBe(true);
  });
});

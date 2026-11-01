import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/lib/db";
import { asSystem, systemRows, testUser } from "@/lib/teams/testing";

import { forgetReleaseCheck, syncActive } from "./sync";
import { activeRun, startRun } from "./store";

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function github(run: { status: string; conclusion?: string | null; steps?: { name: string; number: number; status: string }[] } | null) {
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("/jobs")) return reply({ jobs: [{ steps: run?.steps ?? [] }] });
    const title = `release ${(await activeRun())?.id}`;
    return reply({
      workflow_runs: run
        ? [{ id: 99, html_url: "https://gh/99", status: run.status, conclusion: run.conclusion ?? null, display_title: title }]
        : [],
    });
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
}

describe("syncActive", () => {
  let user: Awaited<ReturnType<typeof testUser>>;

  beforeAll(async () => {
    user = await testUser("release-sync-user");
  });

  beforeEach(() => {
    vi.stubEnv("SPOKEN_RELEASE_GITHUB_TOKEN", "ghp_token");
    vi.stubEnv("SPOKEN_RELEASE_GITHUB_REPO", "rusty-key/spoken-wow");
    forgetReleaseCheck();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await asSystem.query(`delete from "release_run"`);
    await asSystem.query(`delete from "activity" where "kind" like 'release.%'`);
  });

  afterAll(async () => {
    await user.cleanup();
    await closeDb();
  });

  async function age(id: string, minutes: number) {
    await asSystem.query(`update "release_run" set "createdAt" = now() - make_interval(mins => $2) where "id" = $1`, [id, minutes]);
  }

  describe("a job on this machine", () => {
    let shared: string;

    function job(id: string, files: Record<string, string>) {
      const dir = join(shared, "release-runs", id);
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of Object.entries({ log: "", heartbeat: "", ...files })) writeFileSync(join(dir, name), text);
      return dir;
    }

    const row = async (id: string) =>
      (await systemRows<{ state: string; step: string | null; error: string | null }>(
        `select "state", "step", "error" from "release_run" where "id" = $1`, [id],
      ))[0];

    beforeEach(() => {
      shared = mkdtempSync(join(tmpdir(), "release-sync-"));
      vi.stubEnv("SPOKEN_RELEASE_ENV", join(shared, "release.env"));
    });

    it("shows its step without asking GitHub", async () => {
      const run = await startRun("bosses", "frFR", user.id);
      job(run.id, { log: "==> step 1/5: clip pointers\n==> step 2/5: lookup\n" });
      const asked = github(null);
      expect(await syncActive(asked)).toMatchObject({ state: "running", step: "lookup, step 2 of 5" });
      expect(asked).not.toHaveBeenCalled();
    });

    it("settles on its exit code, naming the failure", async () => {
      const good = await startRun("bosses", "frFR", user.id);
      job(good.id, { exit: "0" });
      expect(await syncActive()).toBeNull();
      expect((await row(good.id)).state).toBe("done");

      const bad = await startRun("bosses", "frFR", user.id);
      job(bad.id, { exit: "1", log: "error: SpokenBossesAudio would lose 40 files\n" });
      expect(await syncActive()).toBeNull();
      expect(await row(bad.id)).toMatchObject({ state: "failed", error: "SpokenBossesAudio would lose 40 files" });
    });

    it("frees the lock when the job stops beating", async () => {
      const run = await startRun("bosses", "frFR", user.id);
      const dir = job(run.id, {});
      const old = new Date(Date.now() - 4 * 60_000);
      utimesSync(join(dir, "heartbeat"), old, old);
      expect(await syncActive()).toBeNull();
      expect(await row(run.id)).toMatchObject({ state: "failed", error: "The release process stopped without finishing" });
    });

    it("leaves a run with no job directory to GitHub", async () => {
      await startRun("quests", "frFR", user.id);
      const asked = github({ status: "queued" });
      expect(await syncActive(asked)).toMatchObject({ state: "running", githubUrl: "https://gh/99" });
    });
  });

  it("marks a completed success done and returns nothing active", async () => {
    const run = await startRun("quests", "frFR", user.id);
    expect(await syncActive(github({ status: "completed", conclusion: "success" }))).toBeNull();
    const [row] = await systemRows<{ state: string; githubUrl: string }>(`select "state", "githubUrl" from "release_run" where "id" = $1`, [run.id]);
    expect(row).toEqual({ state: "done", githubUrl: "https://gh/99" });
  });

  it("marks any other conclusion failed, with the conclusion", async () => {
    const run = await startRun("quests", "frFR", user.id);
    expect(await syncActive(github({ status: "completed", conclusion: "cancelled" }))).toBeNull();
    const [row] = await systemRows<{ state: string; error: string }>(`select "state", "error" from "release_run" where "id" = $1`, [run.id]);
    expect(row).toEqual({ state: "failed", error: "cancelled" });
  });

  it("shows a run in progress as running, with its URL and step", async () => {
    await startRun("quests", "frFR", user.id);
    const synced = await syncActive(github({ status: "in_progress", steps: [{ name: "Setup", number: 1, status: "completed" }, { name: "Build", number: 2, status: "in_progress" }] }));
    expect(synced).toMatchObject({ state: "running", githubRunId: 99, githubUrl: "https://gh/99", step: "Build, step 2 of 2" });
  });

  it("counts a queued run as running, with no step", async () => {
    await startRun("quests", "frFR", user.id);
    const synced = await syncActive(github({ status: "queued" }));
    expect(synced).toMatchObject({ state: "running", githubUrl: "https://gh/99", step: null });
  });

  it("leaves a young run that GitHub does not list yet", async () => {
    await startRun("quests", "frFR", user.id);
    expect(await syncActive(github(null))).toMatchObject({ state: "dispatching" });
  });

  it("fails a run GitHub never started once it is old", async () => {
    const run = await startRun("quests", "frFR", user.id);
    await age(run.id, 16);
    expect(await syncActive(github(null))).toBeNull();
    const [row] = await systemRows<{ state: string; error: string }>(`select "state", "error" from "release_run" where "id" = $1`, [run.id]);
    expect(row).toEqual({ state: "failed", error: "GitHub never started it" });
  });

  it("leaves the row alone on a GitHub error while it could still be running", async () => {
    const run = await startRun("quests", "frFR", user.id);
    await age(run.id, 60);
    for (const status of [500, 403]) {
      forgetReleaseCheck();
      const fetchFn = vi.fn().mockResolvedValue(reply({ message: "API rate limit exceeded" }, status));
      expect(await syncActive(fetchFn)).toMatchObject({ id: run.id, state: "dispatching" });
    }
    forgetReleaseCheck();
    expect(await syncActive(vi.fn().mockRejectedValue(new TypeError("fetch failed")))).toMatchObject({ state: "dispatching" });
  });

  it("frees the lock once GitHub's errors outlast any run", async () => {
    const run = await startRun("quests", "frFR", user.id);
    await age(run.id, 9 * 60 + 1);
    const fetchFn = vi.fn().mockResolvedValue(reply({ message: "Bad credentials" }, 401));
    expect(await syncActive(fetchFn)).toBeNull();
    const [row] = await systemRows<{ state: string; error: string }>(`select "state", "error" from "release_run" where "id" = $1`, [run.id]);
    expect(row).toEqual({ state: "failed", error: "Lost track of it: GitHub stopped answering" });
  });

  it("makes no write between steps, when GitHub names none", async () => {
    const run = await startRun("quests", "frFR", user.id);
    await syncActive(github({ status: "in_progress", steps: [{ name: "Build", number: 1, status: "in_progress" }] }));
    forgetReleaseCheck();
    const version = () => systemRows<{ xmin: string }>(`select xmin::text from "release_run" where "id" = $1`, [run.id]);
    const before = await version();
    const synced = await syncActive(github({ status: "in_progress", steps: [{ name: "Build", number: 1, status: "completed" }] }));
    expect(synced).toMatchObject({ state: "running", step: "Build, step 1 of 1" });
    expect(await version()).toEqual(before);
  });

  it("with no token leaves a young row and fails an old one", async () => {
    vi.stubEnv("SPOKEN_RELEASE_GITHUB_TOKEN", "");
    const run = await startRun("quests", "frFR", user.id);
    const fetchFn = vi.fn();
    expect(await syncActive(fetchFn)).toMatchObject({ state: "dispatching" });
    forgetReleaseCheck();
    await age(run.id, 16);
    expect(await syncActive(fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("asks GitHub once inside 15 seconds, and again after, and at once for a new run", async () => {
    const first = await startRun("quests", "frFR", user.id);
    const fetchFn = github({ status: "queued" });
    const t = Date.now();
    await syncActive(fetchFn, t);
    const calls = fetchFn.mock.calls.length;
    expect(await syncActive(fetchFn, t + 14_000)).toMatchObject({ id: first.id });
    expect(fetchFn.mock.calls.length).toBe(calls);
    await syncActive(fetchFn, t + 15_000);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(calls);

    await asSystem.query(`update "release_run" set "state" = 'done' where "id" = $1`, [first.id]);
    const second = await startRun("places", "frFR", user.id);
    const before = fetchFn.mock.calls.length;
    expect(await syncActive(fetchFn, t + 16_000)).toMatchObject({ id: second.id });
    expect(fetchFn.mock.calls.length).toBeGreaterThan(before);
  });
});

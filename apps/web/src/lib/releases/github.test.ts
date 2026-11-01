import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GithubNotConfiguredError, dispatchRelease, findRun } from "./github";

const TOKEN = "ghp_secret_token_value";

function reply(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status });
}

describe("github client", () => {
  beforeEach(() => {
    vi.stubEnv("SPOKEN_RELEASE_GITHUB_TOKEN", TOKEN);
    vi.stubEnv("SPOKEN_RELEASE_GITHUB_REPO", "rusty-key/spoken-wow");
    vi.stubEnv("SPOKEN_RELEASE_GITHUB_REF", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("names a channel only when one is set, so production stays the workflow's default", async () => {
    vi.stubEnv("SPOKEN_RELEASE_CHANNEL", "staging");
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await dispatchRelease({ id: "run-1", section: "quests", lang: "frFR" }, fetchFn);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).inputs.channel).toBe("staging");
  });

  it("dispatches with the exact inputs and the bearer token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(null, 204));
    await dispatchRelease({ id: "run-1", section: "quests", lang: "frFR" }, fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/rusty-key/spoken-wow/actions/workflows/release-packs.yaml/dispatches");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers.Accept).toBe("application/vnd.github+json");
    expect(JSON.parse(init.body)).toEqual({
      ref: "master",
      inputs: { section: "quests", locale: "frFR", manager_only: "true", dry_run: "false", release_id: "run-1" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the configured ref", async () => {
    vi.stubEnv("SPOKEN_RELEASE_GITHUB_REF", "release");
    const fetchFn = vi.fn().mockResolvedValue(reply(null, 204));
    await dispatchRelease({ id: "r", section: "quests", lang: "frFR" }, fetchFn);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).ref).toBe("release");
  });

  it("throws with GitHub's message on a 422, and never with the token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply({ message: "Workflow does not have 'workflow_dispatch' trigger" }, 422));
    const error = await dispatchRelease({ id: "r", section: "quests", lang: "frFR" }, fetchFn).catch((e) => e);
    expect(error.message).toContain("Workflow does not have 'workflow_dispatch' trigger");
    expect(error.message).not.toContain(TOKEN);
  });

  it("says plainly that the token is missing", async () => {
    vi.stubEnv("SPOKEN_RELEASE_GITHUB_TOKEN", "");
    const fetchFn = vi.fn();
    const error = await dispatchRelease({ id: "r", section: "quests", lang: "frFR" }, fetchFn).catch((e) => e);
    expect(error).toBeInstanceOf(GithubNotConfiguredError);
    expect(error.message).toContain("SPOKEN_RELEASE_GITHUB_TOKEN");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  const runs = {
    workflow_runs: [
      { id: 1, html_url: "https://gh/1", status: "completed", conclusion: "success", display_title: "release other" },
      { id: 2, html_url: "https://gh/2", status: "completed", conclusion: "failure", display_title: "release wanted" },
    ],
  };

  it("matches only the right title", async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(runs));
    expect(await findRun("wanted", fetchFn)).toEqual({
      id: 2, url: "https://gh/2", status: "completed", conclusion: "failure", step: null,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toContain("/workflows/release-packs.yaml/runs?event=workflow_dispatch&per_page=50");
    expect(await findRun("absent", fetchFn)).toBeNull();
  });

  it("reads the current step from the jobs of a run that is under way", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/runs/7/jobs")) {
        return reply({
          jobs: [{ steps: [
            { name: "Checkout", number: 1, status: "completed" },
            { name: "Build", number: 2, status: "in_progress" },
            { name: "Upload", number: 3, status: "pending" },
          ] }],
        });
      }
      return reply({ workflow_runs: [{ id: 7, html_url: "https://gh/7", status: "in_progress", conclusion: null, display_title: "release x" }] });
    });
    const found = await findRun("x", fetchFn as unknown as typeof fetch);
    expect(found?.step).toBe("Build, step 2 of 3");
    expect(found?.status).toBe("in_progress");
  });
});

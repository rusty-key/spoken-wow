import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { needsTeamReleases, releasePlan } from "../../../../../scripts/manager/release-pack.mjs";

import {
  currentStep,
  failureReason,
  jobOf,
  outcome,
  readDropletRun,
  releasesClosedFor,
  runsOnDroplet,
  startDropletRun,
} from "./droplet";

let shared: string;

beforeEach(() => {
  shared = mkdtempSync(join(tmpdir(), "release-droplet-"));
  vi.stubEnv("SPOKEN_RELEASE_ENV", join(shared, "release.env"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function fakeSpawn(code: number | Error) {
  return vi.fn(() => {
    const child = new EventEmitter();
    setImmediate(() => (code instanceof Error ? child.emit("error", code) : child.emit("close", code)));
    return child as ChildProcess;
  });
}

describe("runsOnDroplet", () => {
  it("is on with SPOKEN_RELEASE_ENV and off without it", () => {
    expect(runsOnDroplet()).toBe(true);
    vi.stubEnv("SPOKEN_RELEASE_ENV", "");
    expect(runsOnDroplet()).toBe(false);
  });
});

describe("releasesClosedFor", () => {
  const privileged = { official: true, privileged: true };
  const second = { official: false, privileged: false };

  it("refuses any team but the official privileged one until team releases open", () => {
    vi.stubEnv("SPOKEN_TEAM_RELEASES", "");
    expect(releasesClosedFor(privileged)).toBe(false);
    expect(releasesClosedFor(null)).toBe(false);
    expect(releasesClosedFor(second)).toBe(true);
    expect(releasesClosedFor({ official: true, privileged: false })).toBe(true);
    expect(releasesClosedFor({ official: false, privileged: true })).toBe(true);
  });

  it("refuses nobody where they are open", () => {
    vi.stubEnv("SPOKEN_TEAM_RELEASES", "1");
    expect(releasesClosedFor(second)).toBe(false);
  });

  // The job refuses a plan that lists a team where team releases are closed (release.mjs), so a
  // press the site accepts and the job then refuses is a run that fails after the lock is taken.
  it.each([
    ["an official privileged team in a language with no Manager page", "viVN", { official: true, privileged: true }],
    ["an official privileged team on a page", "deDE", { official: true, privileged: true }],
    ["a privileged team that is not official, on a page", "deDE", { official: false, privileged: true }],
    ["a privileged team that is not official, with no page", "viVN", { official: false, privileged: true }],
    ["an official second team", "deDE", { official: true, privileged: false }],
    ["a second team that is not official", "viVN", { official: false, privileged: false }],
  ])("refuses %s exactly when the job would", (_, lang, flags) => {
    vi.stubEnv("SPOKEN_TEAM_RELEASES", "");
    const team = {
      id: "0b7e6a3c-1d2f-4a5b-8c9d-0e1f2a3b4c5d", slug: "stimmen", name: "Stimmen", ...flags,
      language: { code: lang, name: "X", native: "X", client: lang === "deDE" },
    };
    expect(releasesClosedFor(team)).toBe(needsTeamReleases(releasePlan("places", lang, team)));
  });
});

describe("startDropletRun", () => {
  const run = { id: "run-1", kind: "release" as const, section: "bosses", lang: "enUS", teamSlug: "english", bump: "minor" as const, stage: false, staged: null };

  beforeEach(() => {
    mkdirSync(join(shared, "release-tools"));
    vi.stubEnv("SPOKEN_PLACES_ROOT", shared);
    vi.stubEnv("SPOKEN_SECRET_KEY", "site-secret");
  });

  it("forks the job away and hands it none of the site's secrets", async () => {
    const spawnFn = fakeSpawn(0);
    await startDropletRun(run, spawnFn);
    const [command, args, options] = spawnFn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    expect(command).toBe("setsid");
    expect(args[0]).toBe("--fork");
    expect(args).toContain(join(realpathSync(shared), "release-tools/scripts/manager/release-job.mjs"));
    expect(args.at(-1)).toBe(join(shared, "release-runs/run-1"));
    expect(JSON.parse(readFileSync(join(shared, "release-runs/run-1/job.json"), "utf8"))).toEqual({
      kind: "release", section: "bosses", lang: "enUS", bump: "minor", team: "english", stage: false, input: null,
    });
    expect(Object.keys(options.env).sort()).toEqual(["HOME", "NODE_ENV", "PATH", "SPOKEN_RELEASE_ENV"]);
  });

  it("stages a release that asks to, and hands a promotion its entries", async () => {
    expect(jobOf({ ...run, stage: true })).toMatchObject({ kind: "release", stage: true, input: null });
    const staged = { version: "1.0.0", packs: { SpokenBossesAudio_x: { rev: "r" } }, languages: {} };
    await startDropletRun({ ...run, kind: "promote", staged }, fakeSpawn(0));
    expect(JSON.parse(readFileSync(join(shared, "release-runs/run-1/job.json"), "utf8"))).toMatchObject({ kind: "promote", input: staged });
  });

  it("refuses when the fork could not start", async () => {
    await expect(startDropletRun(run, fakeSpawn(new Error("spawn setsid ENOENT")))).rejects.toThrow("ENOENT");
    await expect(startDropletRun(run, fakeSpawn(1))).rejects.toThrow("setsid exited 1");
  });
});

describe("outcome", () => {
  it("reads the version a job released", () => {
    expect(outcome("==> step 3/3: publish\n==> released 2.5.1: SpokenPlacesAudio\n")).toEqual({ state: "done", version: "2.5.1" });
  });

  it("tells a job that found nothing to release", () => {
    expect(outcome("==> step 3/3: publish\n==> nothing changed: nothing was released\n")).toEqual({ state: "unchanged" });
  });

  it("waits for review after a staged release, and is done after a promotion or delisting", () => {
    expect(outcome("==> staged 1.0.3: SpokenPlacesAudio_deDE_x\n")).toEqual({ state: "awaiting_review", version: "1.0.3" });
    expect(outcome("==> staged: SpokenPlacesAudio_deDE_x\n")).toEqual({ state: "awaiting_review", version: null });
    expect(outcome("==> promoted 1.0.3: SpokenPlacesAudio_deDE_x\n")).toEqual({ state: "done", version: "1.0.3" });
    expect(outcome("==> delisted SpokenPlacesAudio_deDE_x\n")).toEqual({ state: "done", version: null });
  });

  it("is done with no version when the log does not say", () => {
    expect(outcome("==> done\n")).toEqual({ state: "done", version: null });
  });
});

describe("readDropletRun", () => {
  function dirWith(id: string, files: Record<string, string>) {
    const dir = join(shared, "release-runs", id);
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  }

  it("is null for a run started elsewhere", async () => {
    expect(await readDropletRun("absent")).toBeNull();
  });

  it("is null with no release env at all", async () => {
    vi.stubEnv("SPOKEN_RELEASE_ENV", "");
    expect(await readDropletRun("x")).toBeNull();
  });

  it("reads a running job, then a finished one", async () => {
    dirWith("a", { log: "hello\n", heartbeat: "" });
    expect(await readDropletRun("a")).toMatchObject({ log: "hello\n", exitCode: null });
    dirWith("a", { exit: "3" });
    expect((await readDropletRun("a"))?.exitCode).toBe(3);
  });

  it("keeps only whole lines of a long log's end", async () => {
    dirWith("b", { log: `first\n${"x".repeat(10_000)}\nlast line\n`, heartbeat: "" });
    expect((await readDropletRun("b"))?.log).toBe("last line\n");
  });
});

describe("what a log says", () => {
  it("names the last step", () => {
    expect(currentStep("==> step 1/5: clip pointers\nbosses: 272\n==> step 2/5: lookup\nwrote\n")).toBe("lookup, step 2 of 5");
    expect(currentStep("")).toBeNull();
  });

  it("prefers the release's own words for a failure", () => {
    expect(failureReason("==> step 1/5: x\nerror: scripts/x.mjs exited 1\n", 1)).toBe("scripts/x.mjs exited 1");
    expect(failureReason("Segmentation fault\n", 139)).toBe("the release exited 139");
    expect(failureReason("error: 2 takes have no Ogg\n  a.mp3\nerror: scripts/x.mjs exited 1\n", 1)).toBe("2 takes have no Ogg");
  });
});

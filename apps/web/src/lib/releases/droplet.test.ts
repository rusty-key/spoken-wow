import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentStep, failureReason, outcome, readDropletRun, runsOnDroplet, startDropletRun } from "./droplet";

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

describe("startDropletRun", () => {
  const run = { id: "run-1", section: "bosses", lang: "enUS" };

  beforeEach(() => {
    mkdirSync(join(shared, "release-tools"));
    vi.stubEnv("SPOKEN_PLACES_ROOT", shared);
    vi.stubEnv("SPOKEN_SECRET_KEY", "site-secret");
  });

  it("forks the job away and hands it none of the site's secrets", async () => {
    const spawnFn = fakeSpawn(0);
    await startDropletRun(run, "minor", spawnFn);
    const [command, args, options] = spawnFn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    expect(command).toBe("setsid");
    expect(args[0]).toBe("--fork");
    expect(args).toContain(join(realpathSync(shared), "release-tools/scripts/manager/release-job.mjs"));
    expect(args.slice(-4)).toEqual([join(shared, "release-runs/run-1"), "bosses", "enUS", "minor"]);
    expect(Object.keys(options.env).sort()).toEqual(["HOME", "NODE_ENV", "PATH", "SPOKEN_RELEASE_ENV"]);
  });

  it("refuses when the fork could not start", async () => {
    await expect(startDropletRun(run, "patch", fakeSpawn(new Error("spawn setsid ENOENT")))).rejects.toThrow("ENOENT");
    await expect(startDropletRun(run, "patch", fakeSpawn(1))).rejects.toThrow("setsid exited 1");
  });
});

describe("outcome", () => {
  it("reads the version a job released", () => {
    expect(outcome("==> step 3/3: publish\n==> released 2.5.1: SpokenPlacesAudio\n")).toEqual({ state: "done", version: "2.5.1" });
  });

  it("tells a job that found nothing to release", () => {
    expect(outcome("==> step 3/3: publish\n==> nothing changed: nothing was released\n")).toEqual({ state: "unchanged" });
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

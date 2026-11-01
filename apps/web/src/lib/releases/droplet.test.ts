import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { currentStep, failureReason, readDropletRun, runsOnDroplet, startDropletRun } from "./droplet";

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
  it("takes what ships the takes as they are, while quests stays on Actions", () => {
    expect(runsOnDroplet("bosses")).toBe(true);
    expect(runsOnDroplet("places")).toBe(true);
    expect(runsOnDroplet("readables")).toBe(true);
    expect(runsOnDroplet("quests")).toBe(false);
  });

  it("is off without SPOKEN_RELEASE_ENV", () => {
    vi.stubEnv("SPOKEN_RELEASE_ENV", "");
    expect(runsOnDroplet("bosses")).toBe(false);
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
    await startDropletRun(run, spawnFn);
    const [command, args, options] = spawnFn.mock.calls[0] as unknown as [string, string[], { env: Record<string, string> }];
    expect(command).toBe("setsid");
    expect(args[0]).toBe("--fork");
    expect(args).toContain(join(realpathSync(shared), "release-tools/scripts/manager/release-job.mjs"));
    expect(args.slice(-3)).toEqual([join(shared, "release-runs/run-1"), "bosses", "enUS"]);
    expect(Object.keys(options.env).sort()).toEqual(["HOME", "NODE_ENV", "PATH", "SPOKEN_RELEASE_ENV"]);
  });

  it("refuses when the fork could not start", async () => {
    await expect(startDropletRun(run, fakeSpawn(new Error("spawn setsid ENOENT")))).rejects.toThrow("ENOENT");
    await expect(startDropletRun(run, fakeSpawn(1))).rejects.toThrow("setsid exited 1");
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
  });
});

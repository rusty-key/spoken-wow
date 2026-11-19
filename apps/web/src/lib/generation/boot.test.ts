/**
 * Which process drains the regeneration queue, and which ticks the release queue: two lifecycles
 * that must not share one start. A process that led the queue from boot, with its worker waiting
 * for a queue request it might never get, left every other process's worker refused the lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const held = vi.hoisted(() => () => true);
const stops = vi.hoisted(() => [] as (() => Promise<unknown>)[]);

vi.mock("./leader", () => ({
  startLeader: () => {
    calls.push("leader");
    return { held, stop: async () => void calls.push("leader.stop") };
  },
}));
vi.mock("./worker", () => ({
  startWorker: (isLeader: () => boolean) => {
    calls.push(isLeader === held ? "worker(leader.held)" : "worker");
    return { stop: async () => void calls.push("worker.stop") };
  },
}));
vi.mock("@/lib/storage/upkeep", () => ({
  startStorageUpkeep: (isLeader: () => boolean) => {
    calls.push(isLeader === held ? "upkeep(leader.held)" : "upkeep");
    return { stop: async () => void calls.push("upkeep.stop") };
  },
}));
vi.mock("@/lib/releases/sync", () => ({ syncActive: async () => void calls.push("release sync") }));
vi.mock("@/lib/teams/store", () => ({ adoptEveryLang: async () => {}, forgetTeams: () => {} }));
vi.mock("@/lib/db", () => ({ inTransaction: async () => {} }));
vi.mock("@/lib/languages/catalogue", () => ({ loadLanguages: async () => {} }));
vi.mock("@/lib/shutdown", () => ({ onShutdown: (stop: () => Promise<unknown>) => stops.push(stop) }));

import { startReleaseTickAtBoot } from "@/instrumentation-node";
import { TICK_MS } from "@/lib/releases/tick";

import { ensureQueueRunning } from "./boot";

const forget = () => {
  for (const name of ["wow-voiceover.queue-boot", "spoken.releases.tick"]) delete (globalThis as Record<symbol, unknown>)[Symbol.for(name)];
};

describe("starting the background work", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    stops.length = 0;
    forget();
    vi.stubEnv("SPOKEN_RELEASE_ENV", "/srv/spoken/release.env");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    forget();
  });

  it("ticks the release queue at boot on the droplet without contending for the regeneration queue", async () => {
    startReleaseTickAtBoot();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(calls).toEqual(["release sync"]);
  });

  it("ticks in pm2's first worker only", async () => {
    vi.stubEnv("NODE_APP_INSTANCE", "1");
    startReleaseTickAtBoot();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(calls).toEqual([]);
    expect(stops).toHaveLength(0);
  });

  it("leads the regeneration queue only with its worker, both started on first use", async () => {
    ensureQueueRunning();
    ensureQueueRunning();
    expect(calls).toEqual(["leader", "worker(leader.held)", "upkeep(leader.held)"]);
    expect(stops).toHaveLength(1);
    await stops[0]();
    expect(calls.slice(3)).toEqual(["upkeep.stop", "worker.stop", "leader.stop"]);
  });
});

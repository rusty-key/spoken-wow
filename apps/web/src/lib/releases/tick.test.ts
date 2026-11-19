import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => ({ syncActive: vi.fn() }));
vi.mock("./sync", () => sync);

const shutdown = vi.hoisted(() => ({ stops: [] as (() => Promise<unknown>)[] }));
vi.mock("@/lib/shutdown", () => ({ onShutdown: (stop: () => Promise<unknown>) => shutdown.stops.push(stop) }));

import { ensureReleaseTick, startReleaseTick, ticksHere, TICK_MS } from "./tick";

describe("the release tick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    sync.syncActive.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("moves the queue on every tick", async () => {
    const tick = startReleaseTick();
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(sync.syncActive).toHaveBeenCalledTimes(3);
    await tick.stop();
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(sync.syncActive).toHaveBeenCalledTimes(3);
  });

  it("skips a tick while the last one still runs", async () => {
    let finish = () => {};
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const tick = startReleaseTick(slow, 1000);
    await vi.advanceTimersByTimeAsync(3500);
    expect(slow).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(slow).toHaveBeenCalledTimes(2);
    finish();
    await tick.stop();
  });

  it("logs a failure and tries again on the next tick", async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error("connection terminated")).mockResolvedValue(null);
    const tick = startReleaseTick(failing, 1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(failing).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("releases: could not move the queue on:", expect.any(Error));
    await tick.stop();
  });

  it("stops only once the round running ends, so a run it claimed gets its job", async () => {
    let launched = false;
    let finish = () => {};
    const round = vi.fn(() => new Promise<void>((resolve) => (finish = () => ((launched = true), resolve()))));
    const tick = startReleaseTick(round, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    let stopped = false;
    const stopping = tick.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(5000);
    expect(stopped).toBe(false);
    finish();
    await stopping;
    expect(launched).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(round).toHaveBeenCalledTimes(1);
  });

  it("stops after its wait when the round never ends", async () => {
    const tick = startReleaseTick(() => new Promise(() => {}), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    let stopped = false;
    void tick.stop(3000).then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(2999);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stopped).toBe(true);
  });

  it("ticks on the droplet in pm2's first worker, or where pm2 numbers none, and nowhere else", () => {
    vi.stubEnv("SPOKEN_RELEASE_ENV", "/srv/spoken/release.env");
    expect(ticksHere({})).toBe(true);
    expect(ticksHere({ NODE_APP_INSTANCE: "0" })).toBe(true);
    expect(ticksHere({ NODE_APP_INSTANCE: "1" })).toBe(false);
    vi.stubEnv("SPOKEN_RELEASE_ENV", "");
    expect(ticksHere({ NODE_APP_INSTANCE: "0" })).toBe(false);
  });

  it("starts once at boot, without the regeneration queue, and drains on shutdown", async () => {
    vi.stubEnv("SPOKEN_RELEASE_ENV", "/srv/spoken/release.env");
    vi.stubEnv("NODE_APP_INSTANCE", "0");
    ensureReleaseTick();
    ensureReleaseTick();
    expect(shutdown.stops).toHaveLength(1);
    expect((globalThis as Record<symbol, unknown>)[Symbol.for("wow-voiceover.queue-boot")]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(sync.syncActive).toHaveBeenCalledTimes(1);
    await shutdown.stops[0]();
    await vi.advanceTimersByTimeAsync(TICK_MS * 2);
    expect(sync.syncActive).toHaveBeenCalledTimes(1);
  });
});

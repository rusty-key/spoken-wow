import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => ({ syncActive: vi.fn() }));
vi.mock("./sync", () => sync);

import { startReleaseTick, TICK_MS } from "./tick";

describe("the release tick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    sync.syncActive.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("moves the queue on every tick", async () => {
    const tick = startReleaseTick(() => true);
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(sync.syncActive).toHaveBeenCalledTimes(3);
    tick.stop();
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(sync.syncActive).toHaveBeenCalledTimes(3);
  });

  it("runs only in the leading process", async () => {
    let leading = false;
    const tick = startReleaseTick(() => leading);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(sync.syncActive).not.toHaveBeenCalled();
    leading = true;
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(sync.syncActive).toHaveBeenCalledTimes(1);
    tick.stop();
  });

  it("skips a tick while the last one still runs", async () => {
    let finish = () => {};
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const tick = startReleaseTick(() => true, slow, 1000);
    await vi.advanceTimersByTimeAsync(3500);
    expect(slow).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(slow).toHaveBeenCalledTimes(2);
    tick.stop();
  });

  it("logs a failure and tries again on the next tick", async () => {
    const failing = vi.fn().mockRejectedValueOnce(new Error("connection terminated")).mockResolvedValue(null);
    const tick = startReleaseTick(() => true, failing, 1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(failing).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("releases: could not move the queue on:", expect.any(Error));
    tick.stop();
  });
});

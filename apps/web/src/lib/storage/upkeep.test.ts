import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryBlobs, useArchiveForTests } from "@/lib/blobs/store";

import { startStorageUpkeep } from "./upkeep";

afterEach(() => vi.useRealTimers());

describe("storage upkeep", () => {
  it("runs only in the leading process, only once our archive is a bucket, and never twice at once", async () => {
    vi.useFakeTimers();
    let leading = false;
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const restore = useArchiveForTests(memoryBlobs(), "r2");
    const upkeep = startStorageUpkeep(() => leading, [{ name: "t", run }]);
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(run).not.toHaveBeenCalled();
      leading = true;
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(run).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      upkeep.stop();
      restore();
    }
  });
});

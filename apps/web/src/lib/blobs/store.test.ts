import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { keep, memoryBlobs, sha256Of, useArchiveForTests } from "./store";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blobs-keep-"));
const data = Buffer.from("kept bytes");
const sha = sha256Of(data);

function refusing() {
  const bucket = memoryBlobs();
  bucket.put = async () => {
    throw new Error("R2 PUT: HTTP 503");
  };
  return bucket;
}

let restore: () => void = () => {};
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("keep", () => {
  it("writes the volume and not the bucket in disk mode", async () => {
    const file = path.join(dir, "disk.mp3");
    expect(await keep("takes", data, "audio/mpeg", file)).toEqual({ sha256: sha, inBucket: false, onDisk: true });
    expect(fs.readFileSync(file).equals(data)).toBe(true);
  });

  it("writes both in dual mode", async () => {
    const bucket = memoryBlobs();
    restore = useArchiveForTests(bucket, "dual");
    const file = path.join(dir, "dual.mp3");
    expect(await keep("takes", data, "audio/mpeg", file)).toEqual({ sha256: sha, inBucket: true, onDisk: true });
    expect(bucket.objects.get(`takes/${sha}`)?.data.equals(data)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("keeps the volume copy and reports no bucket when the PUT fails in dual mode", async () => {
    restore = useArchiveForTests(refusing(), "dual");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = path.join(dir, "dual-refused.mp3");
    expect(await keep("takes", data, "audio/mpeg", file)).toEqual({ sha256: sha, inBucket: false, onDisk: true });
    expect(fs.existsSync(file)).toBe(true);
    expect(logged).toHaveBeenCalledOnce();
  });

  it("throws when the PUT fails in r2 mode, where the bucket is the only copy", async () => {
    restore = useArchiveForTests(refusing(), "r2");
    const file = path.join(dir, "r2-refused.mp3");
    await expect(keep("takes", data, "audio/mpeg", file)).rejects.toThrow("HTTP 503");
    expect(fs.existsSync(file)).toBe(false);
  });
});

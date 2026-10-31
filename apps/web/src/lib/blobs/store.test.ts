import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { keep, memoryBlobs, r2Blobs, sha256Of, useArchiveForTests } from "./store";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blobs-keep-"));
const data = Buffer.from("kept bytes");
const sha = sha256Of(data);

let restore: () => void = () => {};
afterEach(() => {
  restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("keep", () => {
  it("writes the volume and not the bucket in disk mode", async () => {
    const file = path.join(dir, "disk.mp3");
    expect(await keep("takes", data, "audio/mpeg", file)).toBeNull();
    expect(fs.readFileSync(file).equals(data)).toBe(true);
  });

  it("writes both in dual mode", async () => {
    const bucket = memoryBlobs();
    restore = useArchiveForTests(bucket, "dual");
    const file = path.join(dir, "dual.mp3");
    expect(await keep("takes", data, "audio/mpeg", file)).toBe(sha);
    expect(bucket.objects.get(`takes/${sha}`)?.data.equals(data)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("keeps the volume copy and reports no bucket when the PUT fails in dual mode", async () => {
    restore = useArchiveForTests(memoryBlobs({ refusePut: true }), "dual");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = path.join(dir, "dual-refused.mp3");
    expect(await keep("takes", data, "audio/mpeg", file)).toBeNull();
    expect(fs.existsSync(file)).toBe(true);
    expect(logged).toHaveBeenCalledOnce();
  });

  it("throws when the PUT fails in r2 mode, where the bucket is the only copy", async () => {
    restore = useArchiveForTests(memoryBlobs({ refusePut: true }), "r2");
    const file = path.join(dir, "r2-refused.mp3");
    await expect(keep("takes", data, "audio/mpeg", file)).rejects.toThrow("HTTP 503");
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("writing to R2", () => {
  it("never overwrites, and takes an object already under the key as written", async () => {
    const conditions: (string | null)[] = [];
    vi.stubGlobal("fetch", async (request: Request) => {
      conditions.push(request.headers.get("if-none-match"));
      return new Response("PreconditionFailed", { status: 412 });
    });
    const bucket = r2Blobs({ accountId: "a", accessKeyId: "k", secretAccessKey: "s", bucket: "b", publicUrl: "https://p/" });
    await expect(bucket.put("recordings/x", Buffer.from("same bytes"), "audio/ogg")).resolves.toBeUndefined();
    expect(conditions).toEqual(["*"]);
  });
});

describe("reading a range", () => {
  const text = async (body: ReadableStream<Uint8Array> | null) => (body ? new Response(body).text() : null);

  it("cuts the range from memory and reports the whole size and the stored type", async () => {
    const bucket = memoryBlobs();
    await bucket.put("takes/x", Buffer.from("0123456789"), "audio/ogg");
    const part = await bucket.get("takes/x", { suffix: 3 });
    expect(part).toMatchObject({ size: 10, contentType: "audio/ogg", range: { start: 7, end: 9 } });
    expect(await text(part!.body)).toBe("789");
    expect(await bucket.get("takes/x", { start: 10, end: null })).toMatchObject({ size: 10, body: null });
    expect(await bucket.get("takes/missing")).toBeNull();
  });

  it("asks R2 for the range only and reads the size from Content-Range", async () => {
    const asked: (string | null)[] = [];
    vi.stubGlobal("fetch", async (request: Request) => {
      asked.push(request.headers.get("range"));
      return new Response("01", {
        status: 206,
        headers: { "content-type": "audio/mpeg", "content-range": "bytes 0-1/4096" },
      });
    });
    const bucket = r2Blobs({ accountId: "a", accessKeyId: "k", secretAccessKey: "s", bucket: "b", publicUrl: "https://p/" });
    const part = await bucket.get("takes/x", { start: 0, end: 1 });
    expect(asked).toEqual(["bytes=0-1"]);
    expect(part).toMatchObject({ size: 4096, contentType: "audio/mpeg", range: { start: 0, end: 1 } });
    expect(await text(part!.body)).toBe("01");
  });
});

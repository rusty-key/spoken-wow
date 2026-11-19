import { describe, expect, it } from "vitest";

import { memoryBlobs, type BlobStore } from "@/lib/blobs/store";

import { probe } from "./probe";

/** Answers a browser's fetch from the bucket itself. */
const browser = (store: ReturnType<typeof memoryBlobs>) =>
  (async (url: string) => {
    const key = new URL(url).pathname.slice(1);
    const object = store.objects.get(key);
    return object ? new Response(new Uint8Array(object.data)) : new Response("no", { status: 404 });
  }) as typeof fetch;

describe("probe", () => {
  it("passes a bucket that does what the archive relies on, and leaves nothing behind", async () => {
    const store = memoryBlobs({ publicUrl: "https://team.test/" });
    // memoryBlobs replaces on a second put, as a provider ignoring If-None-Match does.
    const result = await probe(store, { fetchImpl: browser(store) });
    expect(result.steps.filter((s) => !s.ok)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.conditionalPut).toBe(false);
    expect(store.objects.size).toBe(0);
  });

  it("sees a bucket that keeps the first bytes", async () => {
    const store = memoryBlobs({ publicUrl: "https://team.test/" });
    const kept: BlobStore = {
      ...store,
      put: async (key, data, type) => {
        if (!store.objects.has(key)) await store.put(key, data, type);
      },
    };
    expect(await probe(kept, { fetchImpl: browser(store) })).toMatchObject({ ok: true, conditionalPut: true });
  });

  it("fails a bucket that answers with bytes neither write sent", async () => {
    const store = memoryBlobs({ publicUrl: "https://team.test/" });
    const garbling: BlobStore = {
      ...store,
      put: async (key, data, type) => store.put(key, Buffer.concat([data.subarray(0, 1000), Buffer.alloc(24)]), type),
    };
    const result = await probe(garbling, { fetchImpl: browser(store) });
    expect(result.steps.find((s) => !s.ok)).toMatchObject({ name: "Never replace an object", detail: "the bucket answered with bytes neither write sent" });
    expect(result.conditionalPut).toBeNull();
  });

  it("follows no redirect from the address a browser would use", async () => {
    const store = memoryBlobs({ publicUrl: "https://team.test/" });
    const redirecting = (async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } });
    }) as typeof fetch;
    const result = await probe(store, { fetchImpl: redirecting });
    expect(result.steps.find((s) => !s.ok)).toMatchObject({ name: "Let a browser fetch it", detail: "HTTP 302 from the public address" });
  });

  it("fails a bucket a browser cannot fetch from, and says which step", async () => {
    const store = memoryBlobs({ publicUrl: "https://team.test/" });
    const result = await probe(store, { fetchImpl: (async () => new Response("denied", { status: 403 })) as typeof fetch });
    expect(result.ok).toBe(false);
    expect(result.steps.find((s) => !s.ok)).toEqual({ name: "Let a browser fetch it", ok: false, detail: "HTTP 403 from the public address" });
  });

  it("fails a bucket that refuses the write, without going further", async () => {
    const result = await probe(memoryBlobs({ refusePut: true }));
    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => s.name)).toEqual(["Write an object", "Say when an object is not there"]);
  });
});

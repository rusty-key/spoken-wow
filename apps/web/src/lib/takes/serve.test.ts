import { afterEach, describe, expect, it } from "vitest";

import { memoryBlobs, useArchiveForTests } from "@/lib/blobs/store";

import { serveTake } from "./serve";

const SHA = "a".repeat(64);
const KEY = `recordings/${SHA}`;
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(96, 1)]);

let restore: () => void = () => {};
afterEach(() => restore());

function bucket() {
  const store = memoryBlobs("https://archive.test/");
  store.objects.set(KEY, { data: OGG, contentType: "audio/ogg" });
  restore = useArchiveForTests(store, "r2");
  return { kind: "blob" as const, key: KEY, url: `https://archive.test/${KEY}` };
}

const get = (headers: Record<string, string> = {}) => new Request("https://spoken.test/audio", { headers });

describe("serveTake from the bucket", () => {
  it("redirects shared audio to the public object", async () => {
    const res = await serveTake(get(), bucket(), { immutable: true });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://archive.test/${KEY}`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("answers audio behind a grant itself, privately, never with the bucket's address", async () => {
    const res = await serveTake(get(), bucket(), { immutable: true, shared: false, lang: "deDE" });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("content-type")).toBe("audio/ogg");
    expect(res.headers.get("content-language")).toBe("de-DE");
    expect(res.headers.get("etag")).toBe(`"${SHA}"`);
    expect(Buffer.from(await res.arrayBuffer()).equals(OGG)).toBe(true);
  });

  it("answers Safari's range probe, a 304 for a tag it holds, and a 404 for a missing object", async () => {
    const stored = bucket();
    const probe = await serveTake(get({ range: "bytes=0-1" }), stored, { immutable: true, shared: false });
    expect(probe.status).toBe(206);
    expect(probe.headers.get("content-range")).toBe(`bytes 0-1/${OGG.byteLength}`);
    expect(Buffer.from(await probe.arrayBuffer()).toString()).toBe("Og");

    expect((await serveTake(get({ "if-none-match": `"${SHA}"` }), stored, { immutable: false, shared: false })).status).toBe(304);

    const missing = { ...stored, key: `recordings/${"b".repeat(64)}` };
    expect((await serveTake(get(), missing, { immutable: true, shared: false })).status).toBe(404);
  });
});

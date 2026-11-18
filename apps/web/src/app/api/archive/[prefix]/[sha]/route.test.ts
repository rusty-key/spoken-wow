/** Needs DATABASE_URL and migrations through 0114. */
import { randomBytes } from "node:crypto";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { memoryBlobs, useArchiveForTests } from "@/lib/blobs/store";
import { closeDb } from "@/lib/db";
import { placeObject, testBackend } from "@/lib/storage/testing";

import { GET, HEAD } from "./route";

const restores: (() => unknown)[] = [];
afterEach(async () => {
  for (const restore of restores.splice(0).reverse()) await restore();
  vi.unstubAllEnvs();
});
afterAll(closeDb);

const ask = (verb: typeof GET, prefix: string, sha: string, headers: Record<string, string> = {}) =>
  verb(new Request(`http://x/api/archive/${prefix}/${sha}`, { headers }), { params: Promise.resolve({ prefix, sha }) });

describe("GET /api/archive/[prefix]/[sha]", () => {
  it("redirects to our bucket, or to the team bucket that holds the object", async () => {
    restores.push(useArchiveForTests(memoryBlobs(), "r2"));
    const backend = await testBackend();
    restores.push(backend.restore);
    const ours = randomBytes(32).toString("hex");
    const theirs = randomBytes(32).toString("hex");
    await placeObject(`encodings/${theirs}`, backend.id);
    expect((await ask(GET, "takes", ours)).headers.get("location")).toBe(`https://archive.test/takes/${ours}`);
    expect((await ask(GET, "encodings", theirs)).headers.get("location")).toBe(`https://team.test/encodings/${theirs}`);
  });

  it("signs for the method asked when the bucket is private", async () => {
    restores.push(useArchiveForTests(memoryBlobs(), "r2"));
    const backend = await testBackend({ publicUrl: null });
    restores.push(backend.restore);
    const sha = randomBytes(32).toString("hex");
    await placeObject(`takes/${sha}`, backend.id);
    const res = await ask(HEAD, "takes", sha);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://signed.test/takes/${sha}?method=HEAD&expires=3600`);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("hands out a recording only for the archive token", async () => {
    restores.push(useArchiveForTests(memoryBlobs(), "r2"));
    vi.stubEnv("SPOKEN_ARCHIVE_TOKEN", "t0ken");
    const sha = randomBytes(32).toString("hex");
    expect((await ask(GET, "recordings", sha)).status).toBe(403);
    expect((await ask(GET, "recordings", sha, { authorization: "Bearer wrong" })).status).toBe(403);
    const granted = await ask(GET, "recordings", sha, { authorization: "Bearer t0ken" });
    expect(granted.status).toBe(302);
    expect(granted.headers.get("cache-control")).toBe("private, no-store");
    // Signed, though our bucket has a public address: that address would outlive the token.
    expect(granted.headers.get("location")).toBe(`https://signed.test/recordings/${sha}?method=GET&expires=3600`);
  });

  it("knows no other prefix or name, and nothing while the archive is the volume", async () => {
    restores.push(useArchiveForTests(memoryBlobs(), "r2"));
    expect((await ask(GET, "references", "a".repeat(64))).status).toBe(404);
    expect((await ask(GET, "takes", "../etc")).status).toBe(404);
    restores.push(useArchiveForTests(memoryBlobs(), "dual"));
    expect((await ask(GET, "takes", "a".repeat(64))).status).toBe(503);
  });
});

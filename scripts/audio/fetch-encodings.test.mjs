import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cacheDir, fillCache } from "./fetch-encodings.mjs";

const hash = (algorithm, text) => createHash(algorithm).update(text).digest("hex");

test("names the cache the way package-audio.sh does", () => {
  assert.equal(cacheDir("enUS", "/c"), "/c/ogg-q0-44k");
  assert.equal(cacheDir("deDE", "/c"), "/c/deDE-ogg-q0-44k");
});

test("lays each encoding under its master's md5, and skips what it cannot place", async () => {
  const archive = mkdtempSync(join(tmpdir(), "enc-archive-"));
  const cache = join(mkdtempSync(join(tmpdir(), "enc-cache-")), "ogg-q0-44k");
  mkdirSync(join(archive, "blobs/takes"), { recursive: true });
  writeFileSync(join(archive, "blobs/takes", hash("sha256", "master")), "master");
  const rows = [
    { sha256: hash("sha256", "master"), encodedSha256: hash("sha256", "ogg") },
    { sha256: hash("sha256", "absent"), encodedSha256: hash("sha256", "other") },
  ];

  const tally = await fillCache(rows, { archive, cache, base: "https://archive.test/", fetchImpl: async () => new Response("ogg") });

  assert.deepEqual({ ...tally, failed: tally.failed.length }, { fetched: 1, cached: 0, noMaster: 1, failed: 0 });
  assert.equal(readFileSync(join(cache, `${hash("md5", "master")}.ogg`), "utf8"), "ogg");

  const again = await fillCache(rows.slice(0, 1), { archive, cache, base: "https://archive.test/", fetchImpl: async () => new Response("x") });
  assert.equal(again.cached, 1);
  assert.equal(existsSync(join(cache, `${hash("md5", "master")}.ogg.part`)), false);
});

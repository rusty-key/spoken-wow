import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { archiveBase, downloadVerified, eachParallel, fetchRetrying } from "./download.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");

test("gives the archive address one trailing slash", () => {
  assert.equal(archiveBase("https://archive.test"), "https://archive.test/");
  assert.equal(archiveBase("https://archive.test/"), "https://archive.test/");
});

test("writes a download that matches its name, and leaves nothing behind for one that does not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "download-"));
  const good = join(dir, "a/good");
  await downloadVerified("u", sha("good"), good, async () => new Response("good"));
  assert.equal(readFileSync(good, "utf8"), "good");

  const bad = join(dir, "a/bad");
  await assert.rejects(downloadVerified("u", sha("expected"), bad, async () => new Response("other")), /hashing to/);
  await assert.rejects(downloadVerified("u", sha("x"), bad, async () => new Response("", { status: 404 })), /HTTP 404/);
  assert.equal(existsSync(bad), false);
  assert.equal(existsSync(`${bad}.part`), false);
});

test("waits out a rate limit, and gives up at once on a missing object", async () => {
  const data = Buffer.from("clip");
  const sha = createHash("sha256").update(data).digest("hex");
  const target = join(mkdtempSync(join(tmpdir(), "download-")), "clip");
  const waits = [];
  const wait = async (ms) => void waits.push(ms);
  const replies = [
    new Response("", { status: 429, headers: { "retry-after": "7" } }),
    new Response("", { status: 503 }),
    new Response(data),
  ];
  await downloadVerified("u", sha, target, async () => replies.shift(), wait);
  assert.deepEqual(waits, [7000, 2000]);
  assert.deepEqual(readFileSync(target), data);

  let calls = 0;
  const missing = async () => (calls++, new Response("", { status: 404 }));
  await assert.rejects(downloadVerified("u", sha, `${target}2`, missing, wait), /HTTP 404/);
  assert.equal(calls, 1);

  const refused = async () => new Response("", { status: 429 });
  await assert.rejects(downloadVerified("u", sha, `${target}3`, refused, wait), /HTTP 429/);
  assert.equal(existsSync(`${target}3`), false);
});

test("runs the work side by side, no more than asked at once", async () => {
  let running = 0;
  let most = 0;
  const done = [];
  await eachParallel(
    [1, 2, 3, 4, 5],
    async (n) => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      done.push(n);
    },
    2,
  );
  assert.equal(most, 2);
  assert.deepEqual(done.sort(), [1, 2, 3, 4, 5]);
});

test("a dropped connection is retried", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    if (++calls < 3) throw new TypeError("fetch failed");
    return new Response("ok");
  };
  const res = await fetchRetrying("https://x", fetchImpl, async () => {});
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
});

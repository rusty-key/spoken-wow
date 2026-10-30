import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { archiveBase, downloadVerified, eachParallel } from "./download.mjs";

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

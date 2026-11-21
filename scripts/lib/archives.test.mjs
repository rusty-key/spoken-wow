import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { sourceOf } from "./archives.mjs";

const SHA = "a".repeat(64);
const saved = process.env.SPOKEN_ARCHIVE_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.SPOKEN_ARCHIVE_URL;
  else process.env.SPOKEN_ARCHIVE_URL = saved;
});

test("names the bucket object when the bucket's address is set", () => {
  process.env.SPOKEN_ARCHIVE_URL = "https://archive.test";
  assert.equal(sourceOf("takes", SHA, "a/b/1.mp3"), `blobs/takes/${SHA}`);
  assert.equal(sourceOf("takes", SHA, ""), `blobs/takes/${SHA}`);
  assert.equal(sourceOf("takes", "", "a/b/1.mp3"), "a/b/1.mp3");
});

test("falls back to the volume path without the bucket's address", () => {
  delete process.env.SPOKEN_ARCHIVE_URL;
  assert.equal(sourceOf("recordings", SHA, "recorded/enUS/x/1.ogg"), "recorded/enUS/x/1.ogg");
  assert.equal(sourceOf("recordings", "", "recorded/enUS/x/1.ogg"), "recorded/enUS/x/1.ogg");
  assert.equal(sourceOf("recordings", "", ""), "");
});

test("refuses a bucket-only row without the bucket's address", () => {
  delete process.env.SPOKEN_ARCHIVE_URL;
  assert.throws(() => sourceOf("takes", SHA, ""), /set SPOKEN_ARCHIVE_URL/);
});

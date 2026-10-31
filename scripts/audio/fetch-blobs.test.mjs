import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { fetchObjects, objectsIn } from "./fetch-blobs.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");

test("keeps only the lines naming an object", () => {
  const a = sha("a");
  assert.deepEqual(objectsIn([`blobs/takes/${a}`, "gossip/31ab/v2-1a2b3c4d.mp3", "", `blobs/other/${a}`]), [
    { path: `blobs/takes/${a}`, prefix: "takes", sha: a },
  ]);
});

test("fetches what is missing, skips what is here, and refuses bytes that do not match", async () => {
  const root = mkdtempSync(join(tmpdir(), "fetch-blobs-"));
  const good = sha("good");
  const here = sha("here");
  const bad = sha("expected");
  mkdirSync(join(root, "blobs/takes"), { recursive: true });
  writeFileSync(join(root, `blobs/takes/${here}`), "here");
  const asked = [];
  const fake = async (url) => {
    asked.push(url);
    const body = url.endsWith(good) ? "good" : "something else";
    return new Response(body);
  };

  const result = await fetchObjects(
    objectsIn([`blobs/takes/${good}`, `blobs/takes/${here}`, `blobs/recordings/${bad}`]),
    root,
    "https://archive.test/",
    fake,
  );

  assert.equal(result.fetched, 1);
  assert.equal(result.present, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0], /hashing to/);
  assert.deepEqual(asked.sort(), [`https://archive.test/recordings/${bad}`, `https://archive.test/takes/${good}`]);
  assert.equal(readFileSync(join(root, `blobs/takes/${good}`), "utf8"), "good");
  assert.equal(existsSync(join(root, `blobs/recordings/${bad}`)), false);
});

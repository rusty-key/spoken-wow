// Runs real ffmpeg and oggenc; skipped without them.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cachedOgg } from "./ogg.mjs";

const encoders = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("oggenc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("two takes sharing a master at once make one cache entry, whole", { skip: !encoders && "needs ffmpeg and oggenc" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ogg-"));
  const master = join(dir, "master.mp3");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", master]);
  const cache = join(dir, "cache");
  const sha = "f".repeat(64);

  const [a, b] = await Promise.all([cachedOgg(master, cache, sha), cachedOgg(master, cache, sha)]);

  assert.equal(a, b);
  assert.deepEqual(readdirSync(cache), [`${sha}.ogg`]);
  assert.equal(readFileSync(a).subarray(0, 4).toString("latin1"), "OggS");
});

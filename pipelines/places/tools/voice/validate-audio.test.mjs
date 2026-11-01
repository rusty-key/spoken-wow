import test from "node:test";
import assert from "node:assert/strict";

import { checkLookup } from "./validate-audio.mjs";

const FULL = [
  "local pack = {",
  "\tversion = 1,",
  "\tzones = {",
  '\t\t[1411] = { file = "1411\\\\zone", len = 89.234 },',
  "\t},",
  "\tsubzones = {",
  "\t\t[1411] = {",
  '\t\t\t["thunder ridge"] = { file = "1411\\\\thunder-ridge", len = 30.1 },',
  "\t\t},",
  "\t},",
  "}",
].join("\n");

const EMPTY = ["local pack = {", "\tversion = 1,", "\tzones = {", "\t},", "\tsubzones = {", "\t},", "}"].join("\n");

const files = ["1411/zone", "1411/thunder-ridge"];

function check(overrides = {}) {
  return checkLookup({
    lookup: FULL,
    onDisk: new Set(files),
    shippedFiles: new Set(files),
    validKeys: new Set(["1411:thunder ridge"]),
    ...overrides,
  });
}

test("a lookup that lists every mp3 on disk passes", () => {
  assert.deepEqual(check(), []);
});

test("an empty lookup beside mp3s fails, even when the manifest is empty too", () => {
  const problems = check({ lookup: EMPTY, shippedFiles: new Set() });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /2 mp3s on disk are not in the lookup table/);
});

test("an mp3 the lookup does not list fails", () => {
  const problems = check({ onDisk: new Set([...files, "1411/orphan"]) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /1411\/orphan\.mp3/);
});

test("a lookup row whose mp3 is missing fails", () => {
  const problems = check({ onDisk: new Set(["1411/zone"]) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /1411\/thunder-ridge\.mp3, which is not on disk/);
});

test("a subzone key the lore does not have fails", () => {
  const problems = check({ validKeys: new Set() });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"thunder ridge" under 1411/);
});

import test from "node:test";
import assert from "node:assert/strict";

import { renderLookup } from "./build-lookup.mjs";
import { checkPack, parseLookup } from "./validate-audio.mjs";

const entry = { map: 36, key: "edwin vancleef", file: "36/edwin-vancleef", len: 41.2 };
const take = { lineId: "boss:36:edwin vancleef", file: "36/edwin-vancleef", durationSec: "41.2", spokenHash: "h1" };
const hashes = new Map([["boss:36:edwin vancleef", "h1"]]);

function check(overrides = {}) {
  return checkPack({
    lookup: parseLookup(renderLookup([entry])),
    onDisk: new Set(["36/edwin-vancleef"]),
    takes: [take],
    hashes,
    ...overrides,
  });
}

test("parseLookup reads back what renderLookup writes", () => {
  const lua = renderLookup([
    entry,
    { map: 36, key: 'a "quoted" \\ key', file: "36/a-quoted-key", len: 3, times: [0, 0.5] },
    { map: 109, key: "zeb", file: "109/zeb", len: 7.25 },
  ]);
  assert.deepEqual(parseLookup(lua), [
    { map: 36, key: 'a "quoted" \\ key', file: "36/a-quoted-key", len: 3 },
    { map: 36, key: "edwin vancleef", file: "36/edwin-vancleef", len: 41.2 },
    { map: 109, key: "zeb", file: "109/zeb", len: 7.25 },
  ]);
});

test("a pack whose lookup, files and takes agree passes", () => {
  const { problems, notes } = check();
  assert.deepEqual(problems, []);
  assert.deepEqual(notes, []);
});

test("a lookup entry whose mp3 is missing fails", () => {
  const { problems } = check({ onDisk: new Set() });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /36\/edwin-vancleef\.mp3.*not on disk/);
});

test("an mp3 the lookup does not list fails", () => {
  const { problems } = check({ onDisk: new Set(["36/edwin-vancleef", "36/orphan"]) });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /36\/orphan\.mp3/);
});

test("a len more than 0.01 s off the take fails, and within it passes", () => {
  assert.equal(check({ takes: [{ ...take, durationSec: "41.205" }] }).problems.length, 0);
  const { problems } = check({ takes: [{ ...take, durationSec: "41.3" }] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /len 41\.2.*41\.3/);
});

test("a null or zero len fails", () => {
  for (const len of [null, 0]) {
    const { problems } = check({ lookup: parseLookup(renderLookup([{ ...entry, len }])) });
    assert.ok(problems.some((p) => /len/.test(p)), `${len}: ${problems}`);
  }
});

test("an entry with no live take, or another file than its take's, fails", () => {
  assert.match(check({ takes: [] }).problems.join("\n"), /no live take/);
  const moved = check({ takes: [{ ...take, file: "36/edwin-vancleef-1" }] });
  assert.match(moved.problems.join("\n"), /36\/edwin-vancleef-1/);
});

test("a stale take is reported and does not fail", () => {
  const { problems, notes } = check({ takes: [{ ...take, spokenHash: "older" }] });
  assert.deepEqual(problems, []);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /boss:36:edwin vancleef.*stale/);
});

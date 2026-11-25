import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdir, readFile, writeFile } from "node:fs/promises";

import { fields, packRow, renderLookup } from "./build-lookup.mjs";

const record = { file: "1411/zone", durationSec: 5 };

test("a take's own words win over the line's words today", () => {
  assert.equal(packRow({ ...record, shownText: "Voiced." }, "Edited since.").text, "Voiced.");
});

test("a take with no words of its own ships the line's words today", () => {
  assert.equal(packRow(record, "Current.").text, "Current.");
});

test("with neither there is no text field, and core's words show", () => {
  const row = packRow(record, undefined);
  assert.equal(row.text, undefined);
  assert.equal(fields(row).includes("text"), false);
});

test("the text field stays one Lua string", () => {
  assert.equal(fields(packRow(record, 'He said "go"\nnow')).endsWith(', text = "He said \\"go\\"\\010now"'), true);
});

// tests/lua/places_source_test.lua loads this fixture as the addon loads a pack, and
// test_speed_pack.py rewrites it as a speed pack does, so a generator change either cannot read
// fails there. Regenerate it with UPDATE_FIXTURES=1.
test("the fixture the Lua tests load is what the generator writes", async () => {
  const zones = new Map([[1411, packRow({ file: "1411/zone", durationSec: 81.9, wordTimes: [0, 1.25, 2.5] }, "Durotar.")]]);
  const subzones = new Map([[1411, new Map([["razor hill", packRow({ file: "1411/razor-hill", durationSec: 12.5 }, undefined)]])]]);
  const fixture = new URL("../../../../tests/fixtures/places/Sounds.lua", import.meta.url);
  const lua = renderLookup(zones, subzones);
  if (process.env.UPDATE_FIXTURES) {
    await mkdir(new URL(".", fixture), { recursive: true });
    await writeFile(fixture, lua);
  }
  assert.equal(await readFile(fixture, "utf8"), lua);
});

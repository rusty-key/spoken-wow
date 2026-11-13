import assert from "node:assert/strict";
import { test } from "node:test";

import { fields, packRow } from "./build-lookup.mjs";

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

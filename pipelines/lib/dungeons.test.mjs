import assert from "node:assert/strict";
import test from "node:test";

import { mapNames } from "./dungeons.mjs";
import { FOREVER_BUILD } from "./wago.mjs";

const row = (ID, MapName_lang) => ({ ID: String(ID), MapName_lang });

/** A Map table per build and locale; any other locale serves English, as wago does. */
function fakeTable(tables) {
  return async (name, { build, locale }) => {
    assert.equal(name, "Map");
    return tables[`${build}/${locale}`] ?? tables[`${build}/enUS`] ?? [];
  };
}

test("each language's names come from Forever's Map table", async () => {
  const table = fakeTable({
    [`${FOREVER_BUILD}/enUS`]: [row(33, "Shadowfang Keep"), row(3001, "The Shaper's Terrace")],
    [`${FOREVER_BUILD}/deDE`]: [row(33, "Burg Shadowfang")],
  });
  const names = await mapNames(() => true, { table });
  assert.equal(names.enUS[33], "Shadowfang Keep");
  assert.equal(names.deDE[33], "Burg Shadowfang");
});

test("only the wanted maps are named", async () => {
  const table = fakeTable({ [`${FOREVER_BUILD}/enUS`]: [row(33, "Shadowfang Keep"), row(1, "Kalimdor")] });
  assert.deepEqual((await mapNames((map) => map === 33, { table })).enUS, { 33: "Shadowfang Keep" });
});


test("an empty table is no sign of English, so a failed fetch shows as missing names", async () => {
  const table = fakeTable({ [`${FOREVER_BUILD}/enUS`]: [row(33, "Shadowfang Keep")], [`${FOREVER_BUILD}/deDE`]: [] });
  assert.deepEqual((await mapNames(() => true, { table })).deDE, {});
});

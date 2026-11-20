import assert from "node:assert/strict";
import test from "node:test";

import { mapNames, STRINGS_BUILD } from "./dungeons.mjs";
import { FOREVER_BUILD } from "./wago.mjs";

const row = (ID, MapName_lang) => ({ ID: String(ID), MapName_lang });

/** A Map table per build and locale; any other locale serves English, as wago does. */
function fakeTable(tables) {
  return async (name, { build, locale }) => {
    assert.equal(name, "Map");
    return tables[`${build}/${locale}`] ?? tables[`${build}/enUS`] ?? [];
  };
}

test("a language wago serves in English takes its names from its last build with strings", async () => {
  const table = fakeTable({
    [`${FOREVER_BUILD}/enUS`]: [row(33, "Shadowfang Keep"), row(3001, "The Shaper's Terrace")],
    [`${FOREVER_BUILD}/deDE`]: [row(33, "Burg Shadowfang"), row(3001, "Die Terrasse des Formers")],
    [`${STRINGS_BUILD.itIT}/itIT`]: [row(33, "Forte Zannascura")],
  });
  const names = await mapNames(() => true, { table });
  assert.equal(names.deDE[33], "Burg Shadowfang");
  assert.equal(names.itIT[33], "Forte Zannascura");
  assert.equal(names.itIT[3001], undefined);
});

test("a language with its own strings in the pinned build keeps them", async () => {
  const table = fakeTable({
    [`${FOREVER_BUILD}/enUS`]: [row(33, "Shadowfang Keep")],
    [`${FOREVER_BUILD}/itIT`]: [row(33, "Forte di Zannascura")],
    [`${STRINGS_BUILD.itIT}/itIT`]: [row(33, "Forte Zannascura")],
  });
  assert.equal((await mapNames(() => true, { table })).itIT[33], "Forte di Zannascura");
});

test("only the wanted maps are named", async () => {
  const table = fakeTable({ [`${FOREVER_BUILD}/enUS`]: [row(33, "Shadowfang Keep"), row(1, "Kalimdor")] });
  assert.deepEqual((await mapNames((map) => map === 33, { table })).enUS, { 33: "Shadowfang Keep" });
});

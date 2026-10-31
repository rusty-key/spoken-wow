import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { outsideAddons, resolveStories, storyInput, storyRows } from "./boss-stories.mjs";
import { ROOT } from "./wiki.mjs";

test("an output under addons/ is refused, anywhere else is taken", () => {
  assert.throws(() => outsideAddons(join(ROOT, "addons/Spoken_Bosses/Data/Stories.lua")), /under addons\//);
  assert.throws(() => outsideAddons("addons/Spoken_Bosses/Data/Stories.lua", ROOT), /under addons\//);
  assert.equal(outsideAddons(join(ROOT, "build/x.json")), join(ROOT, "build/x.json"));
  assert.equal(outsideAddons(join(ROOT, "addons-notes/x.json")), join(ROOT, "addons-notes/x.json"));
});

test("assembled stories become one row per language, the positional English as enUS", () => {
  const rows = storyRows({ 34: { b: { 1: "en", deDE: "de" }, a: "only en" }, 33: { c: { frFR: "fr" } } });
  assert.deepEqual(rows, [
    { map: 33, key: "c", lang: "frFR", text: "fr" },
    { map: 34, key: "a", lang: "enUS", text: "only en" },
    { map: 34, key: "b", lang: "enUS", text: "en" },
    { map: 34, key: "b", lang: "deDE", text: "de" },
  ]);
});

test("an input row's lang defaults to enUS; an unknown one is an error", () => {
  assert.deepEqual(storyInput({ map: 34, key: "a", text: " t " }), { map: 34, key: "a", lang: "enUS", text: "t" });
  assert.equal(storyInput({ map: 34, key: "a", lang: "deDE", text: "t" }).lang, "deDE");
  assert.equal(storyInput({ map: 34, key: "_", text: "t" }), null);
  assert.equal(storyInput({ map: 34, key: "a", text: "  " }), null);
  assert.throws(() => storyInput({ map: 34, key: "a", lang: "xxXX", text: "t" }), /xxXX/);
});

test("stories naming no live boss are split off before anything is recorded", () => {
  const idOf = new Map([["70\tkept", 5]]);
  const { resolved, unresolved } = resolveStories(
    [{ map: 70, key: "kept", lang: "enUS" }, { map: 70, key: "gone", lang: "enUS" }],
    idOf,
  );
  assert.deepEqual(resolved.map((s) => s.bossId), [5]);
  assert.deepEqual(unresolved.map((s) => s.key), ["gone"]);
});

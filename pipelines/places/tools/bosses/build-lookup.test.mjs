import test from "node:test";
import assert from "node:assert/strict";

import { buildEntries, renderLookup } from "./build-lookup.mjs";

test("renderLookup nests by map then key, maps ascending, keys in code-unit order", () => {
  const lua = renderLookup([
    { map: 109, key: "zeb", file: "109/zeb", len: 1 },
    { map: 36, key: "b boss", file: "36/b-boss", len: 2 },
    { map: 36, key: "B boss", file: "36/b-boss-1", len: 3 },
    { map: 36, key: "a boss", file: "36/a-boss", len: 4 },
  ]);
  const order = ['[36] = {', '["B boss"]', '["a boss"]', '["b boss"]', '[109] = {'].map((s) => lua.indexOf(s));
  assert.ok(order.every((i) => i >= 0), lua);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("a file path uses a doubled backslash in Lua", () => {
  const lua = renderLookup([{ map: 36, key: "edwin vancleef", file: "36/edwin-vancleef", len: 41.2 }]);
  assert.ok(lua.includes('file = "36\\\\edwin-vancleef", len = 41.2'), lua);
  assert.ok(lua.includes("SpokenBossesAudioPacks[ADDON_NAME] = pack"));
  assert.ok(lua.includes('"X-SpokenBosses-Language"'));
});

test("a boss with no live take is absent", () => {
  const bosses = [
    { map: 36, key: "a", retired: false },
    { map: 36, key: "b", retired: false },
  ];
  const takes = [{ lineId: "boss:36:a", file: "36/a", durationSec: 5, wordTimes: null }];
  const { entries, skipped } = buildEntries(takes, bosses);
  assert.deepEqual(entries.map((e) => e.key), ["a"]);
  assert.deepEqual(skipped, []);
  assert.ok(!renderLookup(entries).includes('["b"]'));
});

test("a take for no live boss is skipped and reported", () => {
  const bosses = [{ map: 36, key: "a", retired: true }];
  const takes = [
    { lineId: "boss:36:a", file: "36/a", durationSec: 5 },
    { lineId: "boss:9:zz", file: "9/zz", durationSec: 5 },
  ];
  const { entries, skipped } = buildEntries(takes, bosses);
  assert.equal(entries.length, 0);
  assert.deepEqual(skipped, ["36/a", "9/zz"]);
});

test("a key that holds a colon is read back whole", () => {
  const { entries } = buildEntries(
    [{ lineId: "boss:36:a:b", file: "36/ab", durationSec: 5 }],
    [{ map: 36, key: "a:b", retired: false }],
  );
  assert.equal(entries[0].key, "a:b");
});

test("times are written only when the take has word times", () => {
  const withTimes = renderLookup([
    { map: 1, key: "a", file: "1/a", len: 1, times: [0, 0.42, 1.5] },
  ]);
  const without = renderLookup([{ map: 1, key: "a", file: "1/a", len: 1 }]);
  assert.ok(withTimes.includes('times = "0 .42 1.5"'), withTimes);
  assert.ok(!without.includes("times = "));
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { findAbsorptions } from "./absorb.mjs";

test("a minted page whose words one extracted page has in the same language is that page", () => {
  const minted = [{ lineId: "b:nA", texts: { esES: "Trotamundos de los elfos:" } }];
  const extracted = [
    { lineId: "b:900", texts: { esES: "Trotamundos de los elfos:", enUS: "Elf travellers:" } },
    { lineId: "b:901", texts: { esES: "Otra cosa" } },
  ];
  assert.deepEqual(findAbsorptions(minted, extracted), [{ from: "b:nA", to: "b:900" }]);
});

test("two extracted candidates, or two minted claimants, absorb nothing", () => {
  const extracted = [{ lineId: "b:1", texts: { esES: "Same words, twenty-plus long" } }, { lineId: "b:2", texts: { esES: "Same words, twenty-plus long" } }];
  assert.deepEqual(findAbsorptions([{ lineId: "b:nA", texts: { esES: "Same words, twenty-plus long" } }], extracted), []);
  assert.deepEqual(findAbsorptions(
    [{ lineId: "b:nA", texts: { esES: "Other words, twenty-plus long" } }, { lineId: "b:nB", texts: { esES: "Other words, twenty-plus long" } }],
    [{ lineId: "b:3", texts: { esES: "Other words, twenty-plus long" } }],
  ), []);
});

test("the same words in a different language are not the same page", () => {
  const minted = [{ lineId: "b:nA", texts: { esES: "Trotamundos de los elfos:" } }];
  assert.deepEqual(findAbsorptions(minted, [{ lineId: "b:9", texts: { frFR: "Trotamundos de los elfos:" } }]), []);
});

test("hits in two languages on two different pages absorb nothing", () => {
  const minted = [{ lineId: "b:nA", texts: { esES: "Trotamundos de los elfos:", frFR: "Voyageurs des elfes, ici" } }];
  const extracted = [
    { lineId: "b:1", texts: { esES: "Trotamundos de los elfos:" } },
    { lineId: "b:2", texts: { frFR: "Voyageurs des elfes, ici" } },
  ];
  assert.deepEqual(findAbsorptions(minted, extracted), []);
});

test("short or unspeakable text is too common to fold on", () => {
  const extracted = [{ lineId: "b:1", texts: { esES: "Hola." } }, { lineId: "b:2", texts: { esES: "Placeholder text goes here" } }];
  assert.deepEqual(findAbsorptions([{ lineId: "b:nA", texts: { esES: "Hola." } }], extracted), []);
  assert.deepEqual(findAbsorptions([{ lineId: "b:nA", texts: { esES: "$N went to see $R today" } }],
    [{ lineId: "b:3", texts: { esES: "$N went to see $R today" } }]), []);
});

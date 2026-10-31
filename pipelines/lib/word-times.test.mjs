import { test } from "node:test";
import assert from "node:assert/strict";

import { packTimes } from "./word-times.mjs";

test("a take's times pack to hundredths, with no padding", () => {
  assert.equal(packTimes([0, 0.004, 0.42, 1.5, 10, 12.346]), "0 0 .42 1.5 10 12.35");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { quote } from "./lua-text.mjs";

test("prose becomes one Lua string literal", () => {
  assert.equal(quote('Say "hi"\nC:\\x\tend'), '"Say \\"hi\\"\\010C:\\\\x\\009end"');
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { luaText } from "./lua-text.mjs";

test("prose becomes one Lua string literal", () => {
  assert.equal(luaText('Say "hi"\nC:\\x\tend\r'), '"Say \\"hi\\"\\nC:\\\\x\\tend\\r"');
});

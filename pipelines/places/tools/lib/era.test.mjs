import assert from "node:assert/strict";
import test from "node:test";

import { clientNames } from "./era.mjs";

test("an area is named as the client names it, leading The included", () => {
  const names = clientNames(["The Crossroads", "Bloodvenom Post "], []);
  assert.equal(names.get("crossroads"), "The Crossroads");
  assert.equal(names.get("bloodvenom post"), "Bloodvenom Post");
});

test("Forever's spelling wins over Era's, and Era's fills the areas Forever lacks", () => {
  const names = clientNames(["The Bulwark"], ["Bulwark", "Moonbrook"]);
  assert.equal(names.get("bulwark"), "The Bulwark");
  assert.equal(names.get("moonbrook"), "Moonbrook");
});

test("a key the client spells two ways keeps no client name, even where Era spells it once", () => {
  const names = clientNames(["Valley of Trials", "Valley Of Trials"], ["Valley of Trials"]);
  assert.equal(names.has("valley of trials"), false);
});

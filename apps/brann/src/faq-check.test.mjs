import assert from "node:assert/strict";
import { test } from "node:test";

import { check, namesIn } from "./faq-check.mjs";
import { loadFaq } from "./support.mjs";

const fake = {
  text: ["Keep Reading in Background", "Read Every Visit"],
  roots: new Map([["/sp", "Spoken"], ["/spq", "Spoken_Quests"]]),
  addonSource: (addon) => (addon === "Spoken" ? 'elseif command == "skip" then' : "        Test = {"),
};

test("namesIn finds commands and bold names under their headings", () => {
  const { commands, bold } = namesIn("## Q\n\nType `/sp skip` or `/spq`, then turn on **Read Every Visit**.");
  assert.deepEqual(commands, [{ root: "/sp", sub: "skip", heading: "Q" }, { root: "/spq", sub: "", heading: "Q" }]);
  assert.deepEqual(bold, [{ name: "Read Every Visit", heading: "Q" }]);
});

test("a FAQ that names only what exists passes", () => {
  const faq = "## Q\n\n`/sp skip`, `/spq test`, `/reload`, `/sp help`, **Keep Reading in Background**, **Places**.";
  assert.deepEqual(check(faq, fake), []);
});

test("a renamed setting, a gone command and an unknown root each fail, under their heading", () => {
  const faq = "## Volume\n\n**Keep Playing in Background**\n\n## Commands\n\n`/sp skipall` and `/spx`";
  assert.deepEqual(check(faq, fake), [
    '"Commands": /sp skipall is not a command Spoken knows',
    '"Commands": /spx is not a registered command',
    '"Volume": **Keep Playing in Background** is in no English UI string',
  ]);
});

test("the real FAQ matches the real code", () => {
  assert.deepEqual(check(loadFaq()), []);
});

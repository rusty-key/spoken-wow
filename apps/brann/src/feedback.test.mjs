import assert from "node:assert/strict";
import { test } from "node:test";

import { DM_BUTTON, answerComponents, askerOf, ratedComponents, verdictOf } from "./feedback.mjs";

const ids = (components) => components[0].components.map((b) => b.custom_id);

test("an answer carries 👍 and 👎, and Continue in DMs only where asked", () => {
  assert.deepEqual(ids(answerComponents({ dm: true })), ["brann:fb:up", "brann:fb:down", DM_BUTTON]);
  assert.deepEqual(ids(answerComponents({ dm: false })), ["brann:fb:up", "brann:fb:down"]);
  assert.equal(verdictOf(answerComponents({ dm: true })), "unrated");
});

test("a verdict replaces the two buttons, keeps Continue in DMs, and reads back", () => {
  const helped = ratedComponents(answerComponents({ dm: true }), true);
  assert.deepEqual(ids(helped), ["brann:fb:up", DM_BUTTON]);
  assert.equal(helped[0].components[0].disabled, true);
  assert.equal(verdictOf(helped), "helped");
  const notHelped = ratedComponents(answerComponents({ dm: false }), false);
  assert.deepEqual(ids(notHelped), ["brann:fb:down"]);
  assert.equal(verdictOf(notHelped), "not helped");
});

test("a message without buttons has no verdict", () => {
  assert.equal(verdictOf([]), null);
  assert.equal(verdictOf(undefined), null);
});

test("the asker is the player an answer mentions first, else the thread's opener", () => {
  assert.equal(askerOf("<@123> Try this", "999"), "123");
  assert.equal(askerOf("Try this", "999"), "999");
  assert.equal(askerOf("Try this", undefined), null);
});

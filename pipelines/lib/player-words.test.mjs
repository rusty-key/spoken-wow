import assert from "node:assert/strict";
import { test } from "node:test";

import { speakPlayerTokens } from "./player-words.mjs";

test("a translation's tokens become its language's word", () => {
  assert.equal(speakPlayerTokens("Gut gemacht, $N.", "deDE"), "Gut gemacht, Abenteurer.");
});

test("a gendered line takes its own side", () => {
  assert.equal(speakPlayerTokens("$N!", "deDE", "f"), "Abenteurerin!");
});

test("a language with no words keeps its tokens", () => {
  assert.equal(speakPlayerTokens("Hello, $N.", "xxXX"), "Hello, $N.");
});

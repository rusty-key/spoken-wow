import assert from "node:assert/strict";
import { test } from "node:test";

import { registerPlayerWordRows, speakPlayerTokens, writtenPlayerTokens } from "./player-words.mjs";

test("a translation's tokens become its language's word", () => {
  assert.equal(speakPlayerTokens("Gut gemacht, $N.", "deDE"), "Gut gemacht, Abenteurer.");
});

test("a gendered line takes its own side", () => {
  assert.equal(speakPlayerTokens("$N!", "deDE", "f"), "Abenteurerin!");
});

test("a language with no words keeps its tokens", () => {
  assert.equal(speakPlayerTokens("Hello, $N.", "xxXX"), "Hello, $N.");
});

test("a build speaks a team's language in the words its row holds", () => {
  registerPlayerWordRows([
    ["xxXX", '{"m": {"name": "nhà thám hiểm", "race": "lữ khách"}, "f": {"name": "nhà thám hiểm", "race": "lữ khách"}}'],
  ]);
  try {
    assert.equal(speakPlayerTokens("$R, hãy đi đi.", "xxXX"), "Lữ khách, hãy đi đi.");
  } finally {
    registerPlayerWordRows([]);
  }
  assert.equal(speakPlayerTokens("$R, hãy đi đi.", "xxXX"), "$R, hãy đi đi.");
});

test("written tokens are left in the two forms the addon fills", () => {
  assert.equal(writtenPlayerTokens("$$N, $uBürger;Bürgerin: und $ugut:gute;!"), "$N, $gBürger:Bürgerin; und $ggut:gute;!");
  assert.equal(writtenPlayerTokens("$gготов:готова:c; $N"), "$gготов:готова; $N");
  assert.equal(writtenPlayerTokens("Hola, $N. $GHe : She;"), "Hola, $N. $gHe:She;");
});

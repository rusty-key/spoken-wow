import { test } from "node:test";
import assert from "node:assert/strict";

import { currentTextFor, namedBy } from "./relevant.mjs";

const relevant = namedBy(["quests/5-accept", "gossip/abc", "followup/4377-dwarf-male-standard"]);

test("a file a current line names, and its other voices, are carried", () => {
  assert.equal(relevant("quests/5-accept"), true);
  assert.equal(relevant("quests/5-accept-human-male-warrior"), true);
  assert.equal(relevant("followup/4377-dwarf-male-standard-human-male-warrior"), true);
});

test("a player-gender file of a moment the language has as one line is not", () => {
  assert.equal(relevant("gossip/m-abc"), false);
  assert.equal(relevant("gossip/f-abc-human-male-warrior"), false);
  assert.equal(relevant("quests/5-complete"), false);
});

const row = (stem, text, playerGender = "") => ({ stem, text, playerGender });

test("a stem's current text has its tokens spoken as the voice said them", () => {
  const textOf = currentTextFor([row("quests/5-accept", "Gut gemacht, $N.")], "deDE");
  assert.equal(textOf("quests/5-accept"), "Gut gemacht, Abenteurer.");
});

test("a file in another voice takes the text of the file it comes from", () => {
  const textOf = currentTextFor([row("quests/5-accept", "Hello.")], "enUS");
  assert.equal(textOf("quests/5-accept-human-male-warrior"), "Hello.");
});

test("a gendered file takes its own row and its own side", () => {
  const textOf = currentTextFor(
    [row("quests/5-accept", "$N."), row("quests/f-5-accept", "$N.", "f")],
    "deDE",
  );
  assert.equal(textOf("quests/5-accept"), "Abenteurer.");
  assert.equal(textOf("quests/f-5-accept"), "Abenteurerin.");
});

test("of two lines naming one file the first wins, as CURRENT_TEXT_SQL orders them", () => {
  const textOf = currentTextFor([row("quests/5-accept", "One."), row("quests/5-accept", "Two.")], "enUS");
  assert.equal(textOf("quests/5-accept"), "One.");
});

test("a stem no line names has no text", () => {
  assert.equal(currentTextFor([], "enUS")("quests/5-accept"), undefined);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import zlib from "node:zlib";

import { speakPlayerTokens } from "./player-words.mjs";

const CORPUS = new URL("../quests/corpus/corpus.json.gz", import.meta.url);

// What the extract wrote for the tokens before English kept them, and what every take of an
// English line was made from.
const BAKED = [
  ["$b", "\n"], ["$B", "\n"], ["$n", "adventurer"], ["$N", "Adventurer"],
  ["$C", "Adventurer"], ["$c", "adventurer"], ["$R", "Traveler"], ["$r", "traveler"],
];
const GLUED_WORDS = { n: "adventurer", N: "Adventurer", c: "adventurer", C: "Adventurer", r: "traveler", R: "Traveler" };
// tts_utils.py: written_text, then preprocess_dataframe's direction strip and $G sides.
const GENDER = /\$[Gg]\s*([^:;]+?)\s*:\s*([^:;]+?)\s*;/g;
const cleaned = (text, gender) => {
  text = text.replace(/<.*?>\s/g, "");
  return gender ? text.replace(GENDER, gender === "f" ? "$2" : "$1") : text;
};
const baked = (template, gender) => cleaned(BAKED.reduce((t, [k, v]) => t.replaceAll(k, v), template), gender);
const written = (template, gender) =>
  cleaned(
    template.replaceAll("$b", "\n").replaceAll("$B", "\n").replace(/\$([NnCcRr])(?=\p{L})/gu, (_, t) => GLUED_WORDS[t]),
    gender,
  );

test("English's tokens say exactly what the extract used to write, on every corpus line", () => {
  const { lines } = JSON.parse(zlib.gunzipSync(fs.readFileSync(CORPUS)).toString("utf8"));
  const tokened = lines.filter((line) => /\$[NnCcRr]/.test(line.originalText));
  assert.ok(tokened.length > 5000, `only ${tokened.length} lines hold a token`);
  const differ = tokened.filter(({ originalText, playerGender }) => {
    const before = speakPlayerTokens(baked(originalText, playerGender), "enUS", playerGender);
    return speakPlayerTokens(written(originalText, playerGender), "enUS", playerGender) !== before;
  });
  assert.deepEqual(differ.map((line) => line.lineId), []);
});

test("English capitalises a token as it is written, not by its place in the sentence", () => {
  assert.equal(speakPlayerTokens("Well met, $N. $n, the $R and the $c.", "enUS"), "Well met, Adventurer. adventurer, the Traveler and the adventurer.");
});

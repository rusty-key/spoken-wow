import assert from "node:assert/strict";
import { test } from "node:test";

import {
  builtinPlayerWordsOf,
  isBuiltinPlayerWords,
  registerPlayerWordRows,
  speakPlayerTokens,
  speakQuestTokens,
  writtenPlayerTokens,
} from "./player-words.mjs";

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

test("words equal to Spoken's own are the built-in words, so saving them stores no row", () => {
  const ru = builtinPlayerWordsOf("ruRU");
  assert.equal(isBuiltinPlayerWords("ruRU", { m: { ...ru.m, cases: {} }, f: { ...ru.f, nameGenitive: "" } }), true);
  assert.equal(isBuiltinPlayerWords("ruRU", { ...ru, m: { ...ru.m, cases: { 6: { name: "путник" } } } }), false);
  assert.equal(isBuiltinPlayerWords("plPL", { m: { name: "a", race: "b" }, f: { name: "a", race: "b" } }), false);
});

test("a line break and a colour are spoken as the client prints them, in any language", () => {
  // q:4542's neighbours in esMX end with `|n`.
  assert.equal(speakQuestTokens("y tendrás mi gratitud eterna.|n", "esMX"), "y tendrás mi gratitud eterna.\n");
  assert.equal(speakPlayerTokens("Lis |cff00ff00ceci|r, $N.", "frFR"), "Lis ceci, aventurier.");
  assert.equal(speakPlayerTokens("Fin.|n", "xxXX"), "Fin.\n");
  // A `|c` with no colour, as q:4542:accept writes it, is no colour: it stays for the gate.
  assert.equal(speakQuestTokens("extraña.|n|c|n", "esMX"), "extraña.\n|c\n");
});

test("Korean's particle escape takes the form that follows the word before it", () => {
  // The speaker's words end in a vowel: 모험가, 여행자.
  assert.equal(speakQuestTokens("빛이 함께하기를, $c|1이여;여;.", "koKR"), "빛이 함께하기를, 모험가여.");
  assert.equal(speakQuestTokens("상급 $c|1을;를; 만나보십시오.", "koKR"), "상급 모험가를 만나보십시오.");
  assert.equal(speakQuestTokens("$r|1이;가; 왔다.", "koKR"), "여행자가 왔다.");
  // A word ending in a consonant takes the first form; one ending in ㄹ takes 로 for (으)로.
  assert.equal(speakQuestTokens("전사|1은;는; 전사|1으로;로; 남는다.", "koKR"), "전사는 전사로 남는다.");
  assert.equal(speakQuestTokens("용사단|1은;는; 용사단|1으로;로; 간다.", "koKR"), "용사단은 용사단으로 간다.");
  assert.equal(speakQuestTokens("기사들의 길|1으로;로; 간다.", "koKR"), "기사들의 길로 간다.");
});

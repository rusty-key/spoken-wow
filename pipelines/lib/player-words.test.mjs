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

test("a Korean particle glued to a token takes the form that follows the word", () => {
  // Written for a name ending in a consonant; 모험가 and 여행자 end in a vowel.
  assert.equal(speakQuestTokens("$N이 돌아왔군.", "koKR"), "모험가가 돌아왔군.");
  assert.equal(speakQuestTokens("$r을 환영하오. $c과 함께, $N으로서.", "koKR"), "여행자를 환영하오. 모험가와 함께, 모험가로서.");
  assert.equal(speakQuestTokens("$N를 믿는다.", "koKR"), "모험가를 믿는다.");
  // Not a particle where Hangul runs on: 입니다, 님, 에게 stay as written.
  assert.equal(speakQuestTokens("$N입니다. $C님, $c에게.", "koKR"), "모험가입니다. 모험가님, 모험가에게.");
});

test("French's |2 says de before a consonant and d' before a vowel", () => {
  // g:5283b76d…, q:2418:complete, q:96987:accept and q:1955:complete.
  assert.equal(speakQuestTokens("la puissante légion |2 $n ?", "frFR"), "la puissante légion d'aventurier ?");
  assert.equal(speakQuestTokens("rencontré |2 $R plus fiable", "frFR"), "rencontré de voyageur plus fiable");
  assert.equal(speakQuestTokens("mon type |2orc !", "frFR"), "mon type d'orc !");
  assert.equal(speakQuestTokens("morceaux |2 mort-vivant.", "frFR"), "morceaux de mort-vivant.");
});

test("the plural escape takes the form its number does", () => {
  // q:94240:accept.
  assert.equal(speakQuestTokens("заказ на 1 |4пару:пары:пар; перчаток", "ruRU"), "заказ на 1 пару перчаток");
  assert.equal(speakQuestTokens("на 3 |4пару:пары:пар;, 11 |4пару:пары:пар;, 21 |4пару:пары:пар;", "ruRU"), "на 3 пары, 11 пар, 21 пару");
  assert.equal(speakQuestTokens("12 |4пару:пары:пар; и 5 |4пару:пары:пар;", "ruRU"), "12 пар и 5 пар");
  assert.equal(speakQuestTokens("1 |4pair:pairs; and 2 |4pair:pairs;", "enUS"), "1 pair and 2 pairs");
  // With no number before it, nothing says which: it stays for the gate.
  assert.equal(speakQuestTokens("пару |4пару:пары:пар;", "ruRU"), "пару |4пару:пары:пар;");
});

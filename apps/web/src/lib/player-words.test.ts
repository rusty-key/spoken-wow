import { describe, expect, it } from "vitest";

import { branchesOnPlayerGender, playerGenderSides, speakPlayerTokens } from "./player-words";
import { isVoiceable, skipReasonFor } from "./text-gate";

describe("speakPlayerTokens", () => {
  it("addresses the reader with the language's word, lowercase mid-sentence", () => {
    expect(speakPlayerTokens("¡Estupendo, $N! Buen trabajo, $c.", "esES")).toBe(
      "¡Estupendo, aventurero! Buen trabajo, aventurero.",
    );
    expect(speakPlayerTokens("谢谢你，$N。", "zhCN")).toBe("谢谢你，冒险者。");
  });

  it("capitalises at the start of a sentence, not by the token's case", () => {
    expect(speakPlayerTokens("$n, los gnolls siguen ahí.", "esMX")).toBe("Aventurero, los gnolls siguen ahí.");
    expect(speakPlayerTokens("Merci. $N, allez-y.", "frFR")).toBe("Merci. Aventurier, allez-y.");
    expect(speakPlayerTokens("Hola.\n\n¿$N?", "esES")).toBe("Hola.\n\n¿Aventurero?");
  });

  it("capitalises every German noun", () => {
    expect(speakPlayerTokens("Gut gemacht, $c.", "deDE")).toBe("Gut gemacht, Abenteurer.");
  });

  it("speaks $R as the traveller word", () => {
    expect(speakPlayerTokens("Делай свое дело, $r.", "ruRU")).toBe("Делай свое дело, странник.");
  });

  it("takes the feminine form on a line's female variant", () => {
    expect(speakPlayerTokens("Seid gegrüßt, $N.", "deDE", "f")).toBe("Seid gegrüßt, Abenteurerin.");
    expect(speakPlayerTokens("Merci, $N.", "frFR", "f")).toBe("Merci, aventurière.");
  });

  it("speaks QuestIT's Italian, agreeing with the reader where the line has a gender", () => {
    const line = "Sì, possente $C. Sei $Gun:una; $R coraggioso.";
    expect(speakPlayerTokens(line, "itIT")).toBe("Sì, possente avventuriero. Sei un viaggiatore coraggioso.");
    expect(speakPlayerTokens("Grazie, $N.", "itIT", "f")).toBe("Grazie, avventuriera.");
  });

  it("speaks Vietnamese, which has one word for either reader", () => {
    expect(speakPlayerTokens("Cảm ơn, $N.", "viVN", "f")).toBe("Cảm ơn, nhà thám hiểm.");
    expect(speakPlayerTokens("$R, hãy đi đi.", "viVN")).toBe("Lữ khách, hãy đi đi.");
  });

  it("resolves ruRU's three-field $g by the player gender, agreeing with the noun", () => {
    const line = "Привет тебе, $gюный:юная:r; $r.";
    expect(speakPlayerTokens(line, "ruRU")).toBe("Привет тебе, юный странник.");
    expect(speakPlayerTokens(line, "ruRU", "f")).toBe("Привет тебе, юная странница.");
  });

  it("leaves a token glued to a word, so the gate still refuses it", () => {
    expect(speakPlayerTokens("Ну здравствуй, $nдруг:подруга.", "ruRU")).toBe("Ну здравствуй, $nдруг:подруга.");
    expect(speakPlayerTokens("Olá, $Nama.", "ptBR")).toBe("Olá, $Nama.");
  });

  it("speaks a token in Chinese or Korean text, which puts no space after it", () => {
    expect(speakPlayerTokens("不过，你这$c似乎是正想找点什么事情做做呀。", "zhCN")).toBe(
      "不过，你这冒险者似乎是正想找点什么事情做做呀。",
    );
    expect(speakPlayerTokens("$N們，快去吧。", "zhTW")).toBe("冒險者們，快去吧。");
    expect(speakPlayerTokens("고맙네, $N님.", "koKR")).toBe("고맙네, 모험가님.");
    expect(speakPlayerTokens("你好，$$N朋友。", "zhCN")).toBe("你好，冒险者朋友。");
  });

  it("reads $u as the gender branch $g is, in every language", () => {
    // q:87288:accept and q:98321:accept, as the client sent them.
    expect(speakPlayerTokens("Seid gegrüßt, $uReisender:Reisende;.", "deDE")).toBe("Seid gegrüßt, Reisender.");
    expect(speakPlayerTokens("Ihr seid $uEin:Eine:r; $R.", "deDE", "f")).toBe("Ihr seid Eine Reisende.");
    expect(speakPlayerTokens("Olá, $uamigo:amiga;.", "ptBR", "f")).toBe("Olá, amiga.");
  });

  it("reads Forever's $u with its separators swapped, male first", () => {
    // Gossip of npc:253474 and npc:252477 (Friedensbewahrer), as Forever 1.60.1 sent it.
    const line = "Wonach sucht Ihr, $uBürger;Bürgerin:?";
    expect(speakPlayerTokens(line, "deDE")).toBe("Wonach sucht Ihr, Bürger?");
    expect(speakPlayerTokens(line, "deDE", "f")).toBe("Wonach sucht Ihr, Bürgerin?");
    expect(playerGenderSides(line)).toEqual(["Wonach sucht Ihr, Bürger?", "Wonach sucht Ihr, Bürgerin?"]);
    // A $u whose `:` is lost stays refused rather than reading on to the sentence's colon.
    const lost = "Ihr seid $uHeld Heldin; hört gut: geht.";
    expect(speakPlayerTokens(lost, "deDE")).toBe(lost);
    expect(branchesOnPlayerGender(lost)).toBe(false);
    const lostBeforeComma = "Ihr seid $uHeld Heldin;, hört gut: geht.";
    expect(speakPlayerTokens(lostBeforeComma, "deDE")).toBe(lostBeforeComma);
    expect(branchesOnPlayerGender(lostBeforeComma)).toBe(false);
  });

  it("reads a doubled $ before the reader's name, class or race as the token", () => {
    // q:10221:accept, q:2521:accept and gossip of npc:14982, as TBC Anniversary and Forever sent them.
    expect(speakPlayerTokens("$$N, mein früherer Schützling", "deDE")).toBe("Abenteurer, mein früherer Schützling");
    expect(speakPlayerTokens("$$R, kann Euer winziges Gehirn", "deDE")).toBe("Reisender, kann Euer winziges Gehirn");
    expect(speakPlayerTokens("$$C, wir brauchen Eure Unterstützung", "deDE", "f")).toBe(
      "Abenteurerin, wir brauchen Eure Unterstützung",
    );
    expect(speakPlayerTokens("Die Legion $$Ns wartet.", "deDE")).toBe("Die Legion Abenteurers wartet.");
    expect(speakPlayerTokens("Es kostet $$5.", "deDE")).toBe("Es kostet $$5.");
  });

  it("leaves a branch whose ; is lost, rather than reading on to a later sentence's ;", () => {
    // q:97963:accept, its `;` lost: the next `;` would end the female branch and drop the
    // words between unheard.
    const line = "Ein $gAlchimist:Alchimistin in der Stadt. Geht; schnell.";
    expect(speakPlayerTokens(line, "deDE")).toBe("Ein $gAlchimist:Alchimistin in der Stadt. Geht; schnell.");
    expect(speakPlayerTokens("Ein $uHeld:Heldin! Ja; gut.", "deDE")).toBe("Ein $uHeld:Heldin! Ja; gut.");
    expect(speakPlayerTokens("Un $gami:amie\n\nVenez; vite.", "frFR")).toBe("Un $gami:amie\n\nVenez; vite.");
    expect(speakPlayerTokens("一位$g勇士:女勇士。快去;吧。", "zhCN")).toBe("一位$g勇士:女勇士。快去;吧。");
  });

  it("speaks deDE's genitive s glued to $N or $C, and no other glued letter", () => {
    expect(speakPlayerTokens("Die Legion $Ns wartet.", "deDE")).toBe("Die Legion Abenteurers wartet.");
    expect(speakPlayerTokens("dass $cs wie", "deDE", "f")).toBe("dass Abenteurerin wie");
    expect(speakPlayerTokens("$Rs", "deDE")).toBe("$Rs");
    expect(speakPlayerTokens("$Nse", "deDE")).toBe("$Nse");
    expect(speakPlayerTokens("Merci, $Ns.", "frFR")).toBe("Merci, $Ns.");
  });

  it("speaks frFR's class plural $cs as the plural of the reader's word", () => {
    expect(speakPlayerTokens("Les $cs du marais vous attendent.", "frFR")).toBe("Les aventuriers du marais vous attendent.");
    expect(speakPlayerTokens("Les $cs du marais vous attendent.", "frFR", "f")).toBe("Les aventurières du marais vous attendent.");
    expect(speakPlayerTokens("Merci. $cs, en avant !", "frFR")).toBe("Merci. Aventuriers, en avant !");
    expect(speakPlayerTokens("Les $rs du marais.", "frFR")).toBe("Les $rs du marais.");
    expect(speakPlayerTokens("Les $$cs du marais.", "frFR")).toBe("Les aventuriers du marais.");
    expect(speakPlayerTokens("Les $cs'il le faut.", "frFR")).toBe("Les $cs'il le faut.");
  });

  it("speaks English's own word, for the book pages that still carry tokens", () => {
    expect(speakPlayerTokens("$N, bring me my hammer, $gBrother:Sister;.", "enUS")).toBe(
      "Adventurer, bring me my hammer, Brother.",
    );
  });

  it("speaks a writ's count as an order, in the languages that have the words", () => {
    // q:94360:accept, q:94219:accept, q:94241:accept and q:94004:accept, as players sent them.
    expect(speakPlayerTokens("the note is requesting $2oa Soul Pouch, along with", "enUS")).toBe(
      "the note is requesting an order of Soul Pouch, along with",
    );
    expect(speakPlayerTokens("o bilhete solicita $2oax Tisana de Respiração Aquática, além", "ptBR")).toBe(
      "o bilhete solicita algumas unidades de Tisana de Respiração Aquática, além",
    );
    expect(speakPlayerTokens("заказ на $2oa темных кожаных мундира:темных кожаных мундиров, а также", "ruRU")).toBe(
      "заказ на несколько темных кожаных мундиров, а также",
    );
    expect(speakPlayerTokens("заказ на $2oa порции:порций эликсира силы огра, а также", "ruRU")).toBe(
      "заказ на несколько порций эликсира силы огра, а также",
    );
    expect(speakPlayerTokens("verlangt $2oa Seelenbeutel", "deDE")).toBe("verlangt $2oa Seelenbeutel");
  });

  it("leaves a token it has no word for", () => {
    expect(speakPlayerTokens("$2113w Kisten", "deDE")).toBe("$2113w Kisten");
  });
});

describe("branchesOnPlayerGender", () => {
  it("splits a line on $u as on $g", () => {
    expect(branchesOnPlayerGender("Willkommen, $uReisender:Reisende;.")).toBe(true);
    expect(branchesOnPlayerGender("Willkommen, $gReisender:Reisende;.")).toBe(true);
    expect(branchesOnPlayerGender("Olá, $uamigo:amiga;.")).toBe(true);
    expect(branchesOnPlayerGender("Wonach sucht Ihr, $uBürger;Bürgerin:?")).toBe(true);
    expect(branchesOnPlayerGender("Willkommen, $N.")).toBe(false);
  });
});

describe("the text gate on a translation", () => {
  it("voices a translation whose only $ is the reader's name", () => {
    const line = { skipReason: "invalid-chars", lang: "deDE" as const };
    expect(isVoiceable(line, "Gut gemacht, $N.")).toBe(true);
    expect(isVoiceable(line, "$2113w Kisten, $N.")).toBe(false);
    expect(isVoiceable(line, "$$N, welche Neuigkeiten bringt Ihr aus Blackfathom?")).toBe(true);
    expect(isVoiceable(line, "Wonach sucht Ihr, $uBürger;Bürgerin:?")).toBe(true);
  });

  it("stores a translated line as voiceable", () => {
    expect(skipReasonFor("complete", "Merci, $N.", "frFR")).toBeNull();
    expect(skipReasonFor("complete", "Merci, $Nama.", "frFR")).toBe("invalid-chars");
    expect(skipReasonFor("progress", "Merci, $N.", "frFR")).toBe("progress");
  });

  it("voices a frFR line with the class plural $cs", () => {
    expect(skipReasonFor("accept", "Les $cs de Comté-du-Nord vous attendent, $n.", "frFR")).toBeNull();
    expect(skipReasonFor("accept", "Les $cs de Comté-du-Nord vous attendent, $n.", "frFR", "f")).toBeNull();
  });
});

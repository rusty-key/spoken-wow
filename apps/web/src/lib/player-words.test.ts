import { describe, expect, it } from "vitest";

import { speakPlayerTokens } from "./player-words";
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

  it("resolves ruRU's three-field $g by the player gender, agreeing with the noun", () => {
    const line = "Привет тебе, $gюный:юная:r; $r.";
    expect(speakPlayerTokens(line, "ruRU")).toBe("Привет тебе, юный странник.");
    expect(speakPlayerTokens(line, "ruRU", "f")).toBe("Привет тебе, юная странница.");
  });

  it("leaves a token glued to a word, so the gate still refuses it", () => {
    expect(speakPlayerTokens("Ну здравствуй, $nдруг:подруга.", "ruRU")).toBe("Ну здравствуй, $nдруг:подруга.");
    expect(speakPlayerTokens("Olá, $Nama.", "ptBR")).toBe("Olá, $Nama.");
  });

  it("reads deDE's $u as the gender branch $g is", () => {
    // q:87288:accept and q:98321:accept, as the client sent them.
    expect(speakPlayerTokens("Seid gegrüßt, $uReisender:Reisende;.", "deDE")).toBe("Seid gegrüßt, Reisender.");
    expect(speakPlayerTokens("Ihr seid $uEin:Eine:r; $R.", "deDE", "f")).toBe("Ihr seid Eine Reisende.");
    expect(speakPlayerTokens("Hola, $uamigo:amiga;.", "esES")).toBe("Hola, $uamigo:amiga;.");
  });

  it("speaks deDE's genitive s glued to $N or $C, and no other glued letter", () => {
    expect(speakPlayerTokens("Die Legion $Ns wartet.", "deDE")).toBe("Die Legion Abenteurers wartet.");
    expect(speakPlayerTokens("dass $cs wie", "deDE", "f")).toBe("dass Abenteurerin wie");
    expect(speakPlayerTokens("$Rs", "deDE")).toBe("$Rs");
    expect(speakPlayerTokens("$Nse", "deDE")).toBe("$Nse");
    expect(speakPlayerTokens("Merci, $Ns.", "frFR")).toBe("Merci, $Ns.");
  });

  it("speaks English's own word, for the book pages that still carry tokens", () => {
    expect(speakPlayerTokens("$N, bring me my hammer, $gBrother:Sister;.", "enUS")).toBe(
      "Adventurer, bring me my hammer, Brother.",
    );
  });

  it("leaves a token it has no word for", () => {
    expect(speakPlayerTokens("$2113w Kisten", "deDE")).toBe("$2113w Kisten");
  });
});

describe("the text gate on a translation", () => {
  it("voices a translation whose only $ is the reader's name", () => {
    const line = { skipReason: "invalid-chars", lang: "deDE" as const };
    expect(isVoiceable(line, "Gut gemacht, $N.")).toBe(true);
    expect(isVoiceable(line, "$2113w Kisten, $N.")).toBe(false);
  });

  it("stores a translated line as voiceable", () => {
    expect(skipReasonFor("complete", "Merci, $N.", "frFR")).toBeNull();
    expect(skipReasonFor("complete", "Merci, $Nama.", "frFR")).toBe("invalid-chars");
    expect(skipReasonFor("progress", "Merci, $N.", "frFR")).toBe("progress");
  });
});

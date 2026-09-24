import { describe, expect, it } from "vitest";

import { applyFishLexicon, fishRules, fishUse } from "./fish-lexicon";
import type { LexiconEntry } from "./lexicon";

const ENTRIES: LexiconEntry[] = [
  { grapheme: "Thrall", ipa: "θɹɔl", confidence: "high" },
  { grapheme: "Caer", ipa: "kɑɹ", confidence: "high" },
  { grapheme: "Hakkar", ipa: "ˈhækɑɹ", confidence: "high" },
  { grapheme: "Atal'Hakkar", ipa: "ɑtəlˈhækɑɹ", confidence: "high" },
  { grapheme: "Thuzad", alias: "thoozad", confidence: "check" },
  { grapheme: "Gnomeregan", alias: "nomeregan", confidence: "high" },
  { grapheme: "Loch", ipa: "lɔx", confidence: "check" },
];

const phoneme = (arpabet: string) => `<|phoneme_start|>${arpabet}<|phoneme_end|>`;

describe("English", () => {
  const rules = fishRules(ENTRIES, "enUS");
  const apply = (text: string) => applyFishLexicon(text, rules);

  it("speaks IPA as an ARPAbet phoneme tag, and a respelling as written", () => {
    expect(apply("Thrall waits in Gnomeregan.")).toBe(
      `${phoneme("TH R AO1 L")} waits in nomeregan.`,
    );
  });

  it("matches whole words only", () => {
    expect(apply("Caer Darrow, not Caern.")).toBe(`${phoneme("K AA1 R")} Darrow, not Caern.`);
  });

  it("treats an apostrophe as part of a name, except in a possessive", () => {
    expect(apply("Kel'Thuzad")).toBe("Kel'Thuzad");
    expect(apply("Thrall's axe")).toBe(`${phoneme("TH R AO1 L")}'s axe`);
  });

  it("prefers the longest name, and never rewrites a replacement", () => {
    expect(apply("Atal'Hakkar and Hakkar")).toBe(
      `${phoneme("AA0 T AH0 L HH AE1 K AA0 R")} and ${phoneme("HH AE1 K AA0 R")}`,
    );
  });

  it("ignores case, as the lexicon's rules do", () => {
    expect(apply("THRALL!")).toBe(`${phoneme("TH R AO1 L")}!`);
  });

  it("skips an entry whose IPA will not convert", () => {
    expect(apply("Loch Modan")).toBe("Loch Modan");
    expect(fishUse(ENTRIES[6], "enUS")).toBe("unused");
  });
});

describe("another language", () => {
  const rules = fishRules(ENTRIES, "deDE");

  it("uses respellings only: fish.audio has no phoneme format for it", () => {
    expect(applyFishLexicon("Thrall grüßt Gnomeregan.", rules)).toBe("Thrall grüßt nomeregan.");
    expect(fishUse(ENTRIES[0], "deDE")).toBe("unused");
    expect(fishUse(ENTRIES[5], "deDE")).toBe("respelling");
  });

  // Measured on s2.1-pro-free in Russian: IPA and ARPAbet inside phoneme tags both came back
  // as several seconds of invented syllables per name. Nothing but a respelling may reach it.
  it("never sends a phoneme tag, even for IPA that would convert", () => {
    const rules = fishRules([{ grapheme: "Thrall", ipa: "θɹɔl", confidence: "high" }], "ruRU");
    expect(rules).toEqual([]);
    expect(applyFishLexicon("Thrall", rules)).toBe("Thrall");
  });

  it("uses the respelling of an entry carrying both", () => {
    const both: LexiconEntry = { grapheme: "Утер", ipa: "ˈutʲɪr", alias: "У́тер", confidence: "check" };
    expect(fishUse(both, "ruRU")).toBe("respelling");
    expect(applyFishLexicon("Утер ждёт.", fishRules([both], "ruRU"))).toBe("У́тер ждёт.");
  });
});

describe("an entry carrying both, in English", () => {
  const both: LexiconEntry = { grapheme: "Thrall", ipa: "θɹɔl", alias: "thrawl", confidence: "high" };
  const loch: LexiconEntry = { grapheme: "Loch", ipa: "lɔx", alias: "lock", confidence: "check" };

  it("speaks the IPA as a phoneme tag when it converts", () => {
    expect(fishUse(both, "enUS")).toBe("phoneme");
    expect(applyFishLexicon("Thrall", fishRules([both], "enUS"))).toBe(phoneme("TH R AO1 L"));
  });

  it("falls back to the respelling when the IPA does not convert", () => {
    expect(fishUse(loch, "enUS")).toBe("respelling");
    expect(applyFishLexicon("Loch Modan", fishRules([loch], "enUS"))).toBe("lock Modan");
  });
});

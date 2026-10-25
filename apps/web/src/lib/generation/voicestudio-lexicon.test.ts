import { describe, expect, it } from "vitest";

import { CODES } from "@/lib/lang";
import type { LexiconEntry } from "./lexicon";

const { compileVoiceStudioLexicon, voiceStudioRules } = await import("./voicestudio-lexicon");

const ALIAS: LexiconEntry = { grapheme: "Gnomeregan", alias: "nomeregan", confidence: "high" };
const IPA: LexiconEntry = { grapheme: "Gnomeregan", ipa: "ˈnoʊmɹəɡæn", confidence: "high" };

describe("VoiceStudio lexicon", () => {
  it("lowers aliases for every locale", () => {
    for (const lang of CODES) {
      const rules = voiceStudioRules([ALIAS], lang);
      expect(rules, lang).toEqual([{ grapheme: "Gnomeregan", replacement: "nomeregan" }]);
      expect(compileVoiceStudioLexicon(rules)("GNOMEREGAN is near Gnomeregan."), lang).toBe(
        "nomeregan is near nomeregan.",
      );
    }
  });

  it("lowers English IPA to OmniVoice CMU phoneme brackets", () => {
    const rules = voiceStudioRules([IPA], "enUS");
    expect(rules[0]?.replacement).toMatch(/^\[[A-Z0-9 .]+\]$/);
    expect(compileVoiceStudioLexicon(rules)("Gnomeregan is here.")).toMatch(/^\[[A-Z0-9 .]+\] is here\.$/);
  });

  it("does not send unsupported non-English IPA as literal text", () => {
    expect(voiceStudioRules([IPA], "deDE")).toEqual([]);
  });

  it("prefers longer names and keeps apostrophe names intact", () => {
    const rules = voiceStudioRules(
      [
        { ...ALIAS, grapheme: "Hakkar", alias: "ha-kar" },
        { ...ALIAS, grapheme: "Atal'Hakkar", alias: "a-tal-ha-kar" },
      ],
      "frFR",
    );
    const apply = compileVoiceStudioLexicon(rules);
    expect(apply("Atal'Hakkar and Hakkar's temple, not Hakkarian.")).toBe(
      "a-tal-ha-kar and ha-kar's temple, not Hakkarian.",
    );
  });
});

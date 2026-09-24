import { describe, expect, it } from "vitest";

import {
  honoursPhonemes,
  kindOf,
  LexiconError,
  toRules,
  validateEntry,
  validateLexicon,
} from "./lexicon";

// The shape the editor sends. Every entry, every time, matching validateConfig's whole-object
// semantics: a partial update against a lexicon read a moment earlier is how two admins
// silently overwrite each other.
const ENTRY = {
  grapheme: "Gnomeregan",
  ipa: "ˈnoʊmɹəɡæn",
  confidence: "high",
  note: "silent G",
};

describe("validateEntry", () => {
  it("accepts a full entry", () => {
    expect(validateEntry(ENTRY, 0)).toEqual(ENTRY);
  });

  it("keeps the grapheme's case", () => {
    // The grapheme is what a reviewer matches against the corpus by eye. Case-insensitivity
    // is a property of the rule ElevenLabs applies, not of the record.
    expect(validateEntry({ ...ENTRY, grapheme: "Kel'Thuzad" }, 0).grapheme).toBe("Kel'Thuzad");
  });

  it("trims, and drops an empty note rather than storing one", () => {
    const entry = validateEntry({ ...ENTRY, grapheme: "  Thrall  ", note: "   " }, 0);
    expect(entry.grapheme).toBe("Thrall");
    expect(entry).not.toHaveProperty("note");
  });

  // `say` was a human respelling shown beside the IPA, from before entries could be heard.
  // The preview buttons replaced it and `note` covers anything else worth writing down, so
  // it is dropped rather than stored - including off entries that still carry one.
  it("drops a legacy `say` rather than storing it", () => {
    expect(validateEntry({ ...ENTRY, say: "NOME-reh-gan" }, 0)).not.toHaveProperty("say");
  });

  // A rule whose match string contains a space can never fire, because the API bounds a rule
  // at word boundaries. Storing it would be storing a rule that does nothing.
  it("rejects a grapheme containing a space", () => {
    expect(() => validateEntry({ ...ENTRY, grapheme: "Dun Morogh" }, 3)).toThrow(LexiconError);
    expect(() => validateEntry({ ...ENTRY, grapheme: "Dun Morogh" }, 3)).toThrow(/entry 3/);
  });

  // /ˈnoʊmɹəɡæn/ is how a pronunciation is written down for people. ElevenLabs wants the bare
  // phonemes and would otherwise try to pronounce the slashes.
  it("rejects IPA wrapped in delimiters", () => {
    expect(() => validateEntry({ ...ENTRY, ipa: "/ˈnoʊmɹəɡæn/" }, 0)).toThrow(LexiconError);
    expect(() => validateEntry({ ...ENTRY, ipa: "[noʊm]" }, 0)).toThrow(LexiconError);
  });

  it("rejects an empty grapheme", () => {
    expect(() => validateEntry({ ...ENTRY, grapheme: "  " }, 0)).toThrow(/grapheme/);
  });

  // Blanking the IPA does not leave an entry with no pronunciation; it leaves an entry that
  // has neither of the two ways of giving one, which is the error worth reporting.
  it("rejects an entry whose only pronunciation has been blanked", () => {
    expect(() => validateEntry({ ...ENTRY, ipa: "" }, 0)).toThrow(/either IPA or a respelling/);
  });

  it("rejects an unknown confidence", () => {
    expect(() => validateEntry({ ...ENTRY, confidence: "probably" }, 0)).toThrow(/confidence/);
  });

  // Entries seeded by migration 0008 still carry a category the editor no longer shows, and
  // the stored lexicon is one JSON document nothing rewrites until a save.
  it("drops a key it no longer keeps rather than rejecting the entry", () => {
    expect(validateEntry({ ...ENTRY, category: "place" }, 0)).toEqual(ENTRY);
  });

  it("names the index, so the editor can say which entry is wrong", () => {
    expect(() => validateEntry(null, 7)).toThrow(/entry 7/);
  });
});

describe("validateLexicon", () => {
  it("accepts a list", () => {
    expect(validateLexicon([ENTRY])).toEqual([ENTRY]);
  });

  it("rejects anything that is not an array", () => {
    expect(() => validateLexicon({ entries: [ENTRY] })).toThrow(LexiconError);
  });

  // Not merely useless: an empty lexicon would upload a dictionary with no rules and read as
  // a successful save, so every name would quietly revert with nothing on the page to say so.
  it("rejects an empty lexicon", () => {
    expect(() => validateLexicon([])).toThrow(LexiconError);
  });

  // Two rules for one word means ElevenLabs picks one and nothing on the page can say which.
  it("rejects duplicates, comparing the way the rules match", () => {
    const clash = [ENTRY, { ...ENTRY, grapheme: "gnomeregan", ipa: "ɡnoʊmˈɹɛɡən" }];
    expect(() => validateLexicon(clash)).toThrow(/same rule/);
  });

  it("allows two entries that differ by more than case", () => {
    expect(validateLexicon([ENTRY, { ...ENTRY, grapheme: "Gnomeregans" }])).toHaveLength(2);
  });
});

// The other way to say how a name sounds, for anyone who cannot write IPA. Approximate, but
// honoured by every model rather than only by eleven_v3 and eleven_flash_v2.
const RESPELLED = {
  grapheme: "Gnomeregan",
  alias: "nomeregan",
  confidence: "high" as const,
};

describe("respelled entries", () => {
  it("accepts an entry with a respelling instead of IPA", () => {
    expect(validateEntry(RESPELLED, 0)).toEqual(RESPELLED);
    expect(kindOf(validateEntry(RESPELLED, 0))).toBe("alias");
  });

  // Each provider reads the one it can: ElevenLabs the IPA, fish.audio outside English the
  // respelling. So the pair is one entry, not a conflict.
  it("accepts an entry carrying both, and gives ElevenLabs the IPA", () => {
    const both = validateEntry({ ...RESPELLED, ipa: "ˈnoʊmɹəɡæn" }, 0);
    expect(both).toEqual({ ...RESPELLED, ipa: "ˈnoʊmɹəɡæn" });
    expect(kindOf(both)).toBe("ipa");
    expect(toRules([both])).toEqual([
      {
        string_to_replace: "Gnomeregan",
        type: "phoneme",
        phoneme: "ˈnoʊmɹəɡæn",
        alphabet: "ipa",
        case_sensitive: true,
        word_boundaries: true,
      },
    ]);
  });

  it("rejects an entry carrying neither", () => {
    const { alias: _alias, ...neither } = RESPELLED;
    expect(() => validateEntry(neither, 0)).toThrow(/either IPA or a respelling/);
  });

  /**
   * An alias is read aloud as written, so the conventions that make a respelling legible to
   * a person make it worse as speech: capitals can read as an acronym, a hyphen as a pause.
   * The stress-capitals form belongs in `say`, which is never sent.
   */
  it("rejects a respelling written in stress capitals", () => {
    expect(() => validateEntry({ ...RESPELLED, alias: "NOME-reh-gan" }, 0)).toThrow(
      /not in stress capitals/,
    );
  });

  it("keeps a leading capital, which is ordinary spelling rather than stress", () => {
    expect(validateEntry({ ...RESPELLED, alias: "Nomeregan" }, 0).alias).toBe("Nomeregan");
  });

  it("lets one lexicon hold both kinds", () => {
    const mixed = validateLexicon([ENTRY, { ...RESPELLED, grapheme: "Cairne", alias: "cairn" }]);
    expect(mixed.map(kindOf)).toEqual(["ipa", "alias"]);
  });
});

describe("toRules", () => {
  /**
   * case_sensitive MUST be true on a phoneme rule. ElevenLabs discards one carrying false
   * silently - a 200, an id, a version, and the rule simply absent from the stored
   * dictionary. Measured against the real API: the same rule fires with the flag omitted and
   * does not with it set to false. This assertion is the regression guard for a bug that
   * voided all 134 phoneme entries while every surface reported success.
   */
  it("emits case-SENSITIVE, word-bounded phoneme rules", () => {
    expect(toRules(validateLexicon([ENTRY]))).toEqual([
      {
        string_to_replace: "Gnomeregan",
        type: "phoneme",
        phoneme: "ˈnoʊmɹəɡæn",
        alphabet: "ipa",
        case_sensitive: true,
        word_boundaries: true,
      },
    ]);
  });

  // The cost of the above: a name the corpus writes several ways needs a rule per way.
  it("emits one phoneme rule per spelling the corpus uses", () => {
    const rules = toRules(validateLexicon([ENTRY]), { Gnomeregan: ["Gnomeregan", "GNOMEREGAN"] });
    expect(rules.map((r) => r.string_to_replace)).toEqual(["Gnomeregan", "GNOMEREGAN"]);
    expect(rules.every((r) => r.case_sensitive === true)).toBe(true);
    expect(new Set(rules.map((r) => "phoneme" in r && r.phoneme))).toEqual(
      new Set(["ˈnoʊmɹəɡæn"]),
    );
  });

  // A scan can legitimately find nothing - a name no line says yet - and dropping the entry
  // then would un-fix a pronunciation the moment its last line was edited away.
  it("always emits the stored grapheme, even when the corpus never uses it", () => {
    expect(toRules(validateLexicon([ENTRY]), { Gnomeregan: [] })).toHaveLength(1);
    expect(toRules(validateLexicon([ENTRY]), {})).toHaveLength(1);
  });

  /**
   * A lower-case entry gets its capitalised form whether or not the corpus contains one yet.
   * "satyr" beginning a sentence is a fact about English, so it will happen the moment a
   * corpus refresh puts one there - and nothing re-derives the rules until somebody saves.
   */
  it("generates the capitalised form of a lower-case entry", () => {
    const satyr = { ...ENTRY, grapheme: "satyr", ipa: "ˈseɪtəɹ" };
    expect(toRules(validateLexicon([satyr]), {}).map((r) => r.string_to_replace)).toEqual([
      "satyr",
      "Satyr",
    ]);
  });

  // The reverse is not predictable: a proper noun written lower-case is a quirk of one line,
  // which only the corpus can know about. Observed, never generated.
  it("does not invent a lower-case form of a capitalised entry", () => {
    expect(toRules(validateLexicon([ENTRY]), {}).map((r) => r.string_to_replace)).toEqual([
      "Gnomeregan",
    ]);
  });

  it("does not duplicate a capitalised form the corpus already reported", () => {
    const satyr = { ...ENTRY, grapheme: "satyr", ipa: "ˈseɪtəɹ" };
    const rules = toRules(validateLexicon([satyr]), { satyr: ["satyr", "Satyr"] });
    expect(rules.map((r) => r.string_to_replace)).toEqual(["satyr", "Satyr"]);
  });

  it("does not emit the same spelling twice", () => {
    const rules = toRules(validateLexicon([ENTRY]), { Gnomeregan: ["Gnomeregan", "Gnomeregan"] });
    expect(rules).toHaveLength(1);
  });

  /**
   * Aliases keep case_sensitive:false, where it demonstrably works - the flag that kills a
   * phoneme rule is tolerated here, which is exactly why the bug hid for so long: an alias
   * test fired and looked like proof the dictionary was fine.
   */
  it("emits one case-INSENSITIVE alias rule, with no casing expansion", () => {
    expect(toRules(validateLexicon([RESPELLED]), { Gnomeregan: ["GNOMEREGAN"] })).toEqual([
      {
        string_to_replace: "Gnomeregan",
        type: "alias",
        alias: "nomeregan",
        case_sensitive: false,
        word_boundaries: true,
      },
    ]);
  });

  it("does not send the note", () => {
    const [rule] = toRules(validateLexicon([ENTRY]));
    expect(rule).not.toHaveProperty("note");
  });

  // `say` is the stress-capitals form for readers of the editor; `alias` is what a model is
  // asked to read. Conflating them would send "NOME-REH-GAN" to be spoken.
  it("never sends `say` as an alias", () => {
    const [rule] = toRules(validateLexicon([RESPELLED]));
    expect(rule).toMatchObject({ alias: "nomeregan" });
  });
});

describe("honoursPhonemes", () => {
  // The whole feature is inert on any other model: ElevenLabs skips phoneme rules silently
  // and speaks the default pronunciation, so the editor has to warn rather than imply a save
  // took effect.
  it("knows which models honour a phoneme rule", () => {
    expect(honoursPhonemes("eleven_v3")).toBe(true);
    expect(honoursPhonemes("eleven_flash_v2")).toBe(true);
    expect(honoursPhonemes("eleven_multilingual_v2")).toBe(false);
    expect(honoursPhonemes("eleven_turbo_v2_5")).toBe(false);
  });
});

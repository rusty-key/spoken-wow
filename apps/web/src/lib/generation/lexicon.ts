/**
 * The pronunciation lexicon: what a name is, and how ElevenLabs should say it.
 *
 * Shapes and validation only, with no node:fs and no pg, for the reason config.ts has none:
 * the editor is a client component and must be able to import the types and check a draft
 * before sending it, without dragging the server's dependencies into the browser bundle.
 *
 * An entry says how a name sounds in one of two ways, and the choice is not cosmetic:
 *
 *   ipa    a phoneme rule. Exact, and honoured by eleven_v3 and eleven_flash_v2 only - every
 *          other model silently ignores it and speaks the default pronunciation.
 *   alias  a respelling. Approximate, because it is only as good as the reader's guess at
 *          the new spelling, but honoured by every model.
 *
 * An entry may carry both, because the two providers can read different things. ElevenLabs
 * takes one rule per word, so it gets the IPA whenever there is one and the respelling only
 * otherwise - which rule it holds is always knowable from the entry. fish.audio reads IPA in
 * English alone (converted to ARPAbet) and elsewhere only the respelling: see fish-lexicon.
 * Writing both is how one entry serves both.
 */

export const CONFIDENCES = ["high", "check"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** Models that honour phoneme rules. Everything else ignores the dictionary entirely. */
export const PHONEME_MODELS = ["eleven_v3", "eleven_flash_v2"] as const;

export function honoursPhonemes(modelId: string): boolean {
  return (PHONEME_MODELS as readonly string[]).includes(modelId);
}

export type LexiconEntry = {
  /** The word as the corpus writes it. Matched case-insensitively, so one spelling suffices. */
  grapheme: string;
  /** Exact pronunciation, for anyone who can write IPA. At least one of ipa and alias. */
  ipa?: string;
  /**
   * A respelling ElevenLabs reads in place of the name, for anyone who cannot.
   *
   * Written as something a reader would simply say - "nomeregan", not "NOME-reh-gan". The
   * capitals-for-stress convention is for people: sent to a model, capitals can read as an
   * acronym and hyphens as pauses, which is a worse pronunciation than the one being fixed.
   */
  alias?: string;
  confidence: Confidence;
  note?: string;
};

/**
 * Which kind of rule an entry becomes on ElevenLabs: the IPA when there is one, since it is
 * exact, and the respelling otherwise.
 */
export function kindOf(entry: LexiconEntry): "ipa" | "alias" {
  return entry.ipa ? "ipa" : "alias";
}

export class LexiconError extends Error {}

/**
 * A rule as the add-from-rules endpoint wants it.
 *
 * case_sensitive differs by kind, and not by preference:
 *
 *   phoneme  MUST be true. ElevenLabs discards a phoneme rule carrying case_sensitive:false
 *            silently - a 200, an id, a version, and the rule simply absent from the stored
 *            dictionary. Measured, not inferred: the same rule with the flag omitted fires,
 *            and with it set to false does not. So a name spelled several ways in the corpus
 *            needs one rule per spelling, which is what `casings` supplies.
 *   alias    stays false, where the flag works and one rule covers every spelling.
 *
 * word_boundaries is true throughout and is innocent of the above - a rule carrying it fires
 * normally. Without it "Caer" would match inside "Caern".
 */
type Matching = {
  string_to_replace: string;
  word_boundaries: true;
};

export type DictionaryRule =
  | (Matching & { case_sensitive: true; type: "phoneme"; phoneme: string; alphabet: "ipa" })
  | (Matching & { case_sensitive: false; type: "alias"; alias: string });

/**
 * The rules for a lexicon.
 *
 * `casings` maps a grapheme to every spelling of it the corpus actually contains, so a
 * phoneme entry becomes one rule per spelling. Absent, or missing an entry, means the
 * grapheme alone - which is right for a name that only ever appears one way, and is what
 * the browser passes when it has no corpus to consult.
 */
export function toRules(
  entries: LexiconEntry[],
  casings: Record<string, string[]> = {},
): DictionaryRule[] {
  return entries.flatMap((entry): DictionaryRule[] => {
    if (kindOf(entry) === "alias") {
      return [
        {
          string_to_replace: entry.grapheme,
          case_sensitive: false,
          word_boundaries: true,
          type: "alias",
          alias: entry.alias!,
        },
      ];
    }

    // Deduplicated and with the stored grapheme guaranteed present: a scan of the corpus can
    // legitimately return nothing for a name nobody says yet, and dropping the entry then
    // would silently un-fix a pronunciation the moment its last line was edited away.
    //
    // The capitalised form of a lower-case entry is GENERATED rather than observed, and that
    // asymmetry is deliberate. "satyr" starting a sentence is a property of English, so it
    // will happen the moment a corpus refresh puts one there - whereas a proper noun appearing
    // lower-case is a quirk of how somebody typed a particular line, which only the corpus can
    // know. So predict the one and scan for the other.
    const spellings = [
      ...new Set([
        entry.grapheme,
        ...(startsLower(entry.grapheme) ? [capitalise(entry.grapheme)] : []),
        ...(casings[entry.grapheme] ?? []),
      ]),
    ];

    return spellings.map((spelling) => ({
      string_to_replace: spelling,
      case_sensitive: true,
      word_boundaries: true,
      type: "phoneme",
      phoneme: entry.ipa!,
      alphabet: "ipa",
    }));
  });
}

function startsLower(word: string): boolean {
  return word[0] === word[0].toLowerCase() && word[0] !== word[0].toUpperCase();
}

function capitalise(word: string): string {
  return word[0].toUpperCase() + word.slice(1);
}

/** A trimmed value, or "" when the field is absent, blank, or not a string. */
function optional(raw: Record<string, unknown>, key: string): string {
  return typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
}

function text(raw: Record<string, unknown>, key: string, where: string): string {
  const value = raw[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new LexiconError(`${where}: ${key} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Coerce and check one untrusted entry, or throw LexiconError.
 *
 * The grapheme is trimmed but never case-folded. It is what the editor displays and what a
 * reviewer matches against the corpus by eye, so "Kel'Thuzad" has to stay "Kel'Thuzad" -
 * case-insensitivity is a property of the rule ElevenLabs applies, not of the record here.
 */
export function validateEntry(input: unknown, index: number): LexiconEntry {
  const where = `entry ${index}`;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new LexiconError(`${where} must be an object`);
  }
  const raw = input as Record<string, unknown>;

  const grapheme = text(raw, "grapheme", where);

  // A grapheme with a space would need the rule to match across a word boundary the API
  // treats as a separator, so it would simply never fire. Rejecting it is kinder than
  // storing a rule that does nothing.
  if (/\s/.test(grapheme)) {
    throw new LexiconError(`${where}: "${grapheme}" contains a space, which never matches`);
  }

  // At least one. Both is fine: each provider reads the one it can, and kindOf says which
  // ElevenLabs gets.
  const ipa = optional(raw, "ipa");
  const alias = optional(raw, "alias");
  if (!ipa && !alias) {
    throw new LexiconError(`${where}: "${grapheme}" needs either IPA or a respelling`);
  }

  // IPA delimiters are a human convention for writing pronunciations down; ElevenLabs wants
  // the bare phonemes and would try to pronounce a slash.
  if (ipa && /[/[\]]/.test(ipa)) {
    throw new LexiconError(`${where}: IPA for "${grapheme}" must not include / or [ ]`);
  }

  // An alias is read aloud as written, so the stress-capitals convention makes it worse as
  // speech: capitals can read as an acronym, and a hyphen as a pause. "nomeregan" is a
  // pronunciation; "NOME-reh-gan" is a note about one, and belongs in `note` if anywhere.
  if (alias && /[A-Z]{2,}/.test(alias)) {
    throw new LexiconError(
      `${where}: respell "${grapheme}" as it should be said, not in stress capitals`,
    );
  }

  const confidence = raw.confidence;
  if (!(CONFIDENCES as readonly unknown[]).includes(confidence)) {
    throw new LexiconError(`${where}: unknown confidence ${JSON.stringify(confidence)}`);
  }

  // Anything else on the object - `category`, which entries seeded by migration 0008 still
  // carry - is dropped here rather than migrated away: the lexicon is stored as one JSON
  // document, so a key nobody reads disappears the next time the editor saves.
  const entry: LexiconEntry = {
    grapheme,
    confidence: confidence as Confidence,
  };
  if (ipa) entry.ipa = ipa;
  if (alias) entry.alias = alias;
  if (typeof raw.note === "string" && raw.note.trim()) entry.note = raw.note.trim();
  return entry;
}

/**
 * Coerce and check a whole lexicon, or throw LexiconError.
 *
 * Duplicate graphemes are rejected rather than deduplicated. Two rules for one word means
 * ElevenLabs picks one and nothing on this page can say which, so a lexicon that contains
 * both is not a lexicon anyone can reason about. Compared case-insensitively, because the
 * rules themselves are.
 */
export function validateLexicon(input: unknown): LexiconEntry[] {
  if (!Array.isArray(input)) throw new LexiconError("expected an array of entries");
  if (input.length === 0) {
    throw new LexiconError("a lexicon with no entries would be a dictionary that says nothing");
  }

  const entries = input.map(validateEntry);

  const seen = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.grapheme.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      throw new LexiconError(
        `"${entry.grapheme}" and "${first}" are the same rule; matching ignores case`,
      );
    }
    seen.set(key, entry.grapheme);
  }

  return entries;
}

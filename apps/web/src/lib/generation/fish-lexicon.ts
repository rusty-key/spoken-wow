/**
 * The pronunciation lexicon, applied to the text itself for fish.audio.
 *
 * ElevenLabs is handed the lexicon as a dictionary it applies on its side. fish.audio has
 * dictionaries too, and they are not used, for two reasons: their keys match literal
 * substrings with no word boundary, so "Caer" would fire inside "Caern" (the very case
 * word_boundaries exists for on ElevenLabs), and their values may only be phonemes, which
 * leaves every respelling out. So the rules are applied here, before the request:
 *
 *   ipa    English only, converted to ARPAbet and written as a phoneme tag. fish.audio has
 *          phoneme control for English, Chinese and Japanese only, and IPA for none of them.
 *   alias  every language, substituted as it is written.
 *
 * Free of server imports, because the lexicon editor shows which entries fish.audio uses.
 *
 * Applied last, after shaping, so the text the staleness check hashes is the text before
 * the lexicon for both providers; a lexicon edit is the dirty-takes check's question, not a
 * text change.
 */
import { BASE_LANG, type Lang } from "@/lib/lang";

import { ipaToArpabet } from "./ipa-arpabet";
import type { LexiconEntry } from "./lexicon";

export type FishRule = { grapheme: string; replacement: string };

/** How fish.audio will use an entry, which the lexicon editor shows beside it. */
export type FishUse = "phoneme" | "respelling" | "unused";

export function fishUse(entry: LexiconEntry, lang: Lang): FishUse {
  if (entry.alias) return "respelling";
  return lang === BASE_LANG && entry.ipa && ipaToArpabet(entry.ipa) ? "phoneme" : "unused";
}

/**
 * The entries fish.audio can use in `lang`, as replacements. `phoneme` writes the ARPAbet for a
 * provider with another phoneme syntax.
 */
export function fishRules(
  entries: LexiconEntry[],
  lang: Lang,
  phoneme: (arpabet: string) => string = (arpabet) => `<|phoneme_start|>${arpabet}<|phoneme_end|>`,
): FishRule[] {
  return entries.flatMap((entry): FishRule[] => {
    if (entry.alias) return [{ grapheme: entry.grapheme, replacement: entry.alias }];
    if (lang !== BASE_LANG || !entry.ipa) return [];
    const arpabet = ipaToArpabet(entry.ipa);
    return arpabet ? [{ grapheme: entry.grapheme, replacement: phoneme(arpabet) }] : [];
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every rule applied in one pass, so a replacement is never matched again by a later rule.
 *
 * Longest grapheme first, so "Atal'Hakkar" wins over "Hakkar" where both would match. A
 * word boundary is no letter, digit or apostrophe touching the match: the apostrophe
 * because names are built with one, and neither "Kel" nor "Thuzad" is a word inside
 * "Kel'Thuzad". Case-insensitive, as the lexicon's own rules are.
 */
export function applyFishLexicon(text: string, rules: FishRule[]): string {
  return compileFishLexicon(rules)(text);
}

/** The rules as one function, so a batch builds the pattern once rather than per line. */
export function compileFishLexicon(rules: FishRule[]): (text: string) => string {
  if (rules.length === 0) return (text) => text;
  const byGrapheme = new Map(rules.map((rule) => [rule.grapheme.toLowerCase(), rule.replacement]));
  const alternation = [...byGrapheme.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  // After the match: no letter or digit, and no apostrophe leading into more of a name --
  // except a possessive, so "Thrall's" is still Thrall.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}'’])(${alternation})(?![\\p{L}\\p{N}]|['’](?!s(?![\\p{L}\\p{N}]))\\p{L})`,
    "giu",
  );
  return (text) => text.replace(pattern, (match) => byGrapheme.get(match.toLowerCase()) ?? match);
}

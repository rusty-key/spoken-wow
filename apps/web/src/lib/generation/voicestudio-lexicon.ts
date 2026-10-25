/**
 * The pronunciation rules VoiceStudio can receive in its text request.
 *
 * VoiceStudio's HTTP service does not share Spoken's database, so the active locale's
 * lexicon has to be lowered before the request is sent:
 *
 *   alias  every locale, as a respelling
 *   ipa    English, as OmniVoice's bracketed CMU phonemes
 *
 * The alias path is deliberately locale-agnostic. IPA is only lowered when the target
 * engine has a compatible phoneme alphabet; sending raw IPA to another locale would make
 * the model read the symbols as text rather than pronounce them.
 */
import crypto from "node:crypto";

import { BASE_LANG, type Lang } from "@/lib/lang";

import { lexiconStamp, readLexicon } from "./dictionary";
import { ipaToArpabet } from "./ipa-arpabet";
import type { LexiconEntry } from "./lexicon";

export type VoiceStudioRule = { grapheme: string; replacement: string };

type CompiledLexicon = {
  stamp: string | null;
  apply: (text: string) => string;
  version: string | null;
};

const lexicons = new Map<Lang, CompiledLexicon>();

/** Convert the entries that VoiceStudio can honor for one locale. */
export function voiceStudioRules(entries: LexiconEntry[], lang: Lang): VoiceStudioRule[] {
  return entries.flatMap((entry): VoiceStudioRule[] => {
    if (entry.alias) return [{ grapheme: entry.grapheme, replacement: entry.alias }];
    if (lang !== BASE_LANG || !entry.ipa) return [];

    const arpabet = ipaToArpabet(entry.ipa);
    return arpabet ? [{ grapheme: entry.grapheme, replacement: `[${arpabet}]` }] : [];
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match the same whole-name shape as the other text-side provider rules.
 * Longer names win, and a name is not matched inside a larger word or apostrophe name.
 */
export function compileVoiceStudioLexicon(rules: VoiceStudioRule[]): (text: string) => string {
  if (rules.length === 0) return (text) => text;

  const byGrapheme = new Map(rules.map((rule) => [rule.grapheme.toLowerCase(), rule.replacement]));
  const alternation = [...byGrapheme.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}'’])(${alternation})(?![\\p{L}\\p{N}]|['’](?!s(?![\\p{L}\\p{N}]))\\p{L})`,
    "giu",
  );

  return (text) => text.replace(pattern, (match) => byGrapheme.get(match.toLowerCase()) ?? match);
}

async function voiceStudioLexicon(lang: Lang): Promise<CompiledLexicon> {
  const stamp = await lexiconStamp(lang);
  const cached = lexicons.get(lang);
  if (cached && cached.stamp === stamp) return cached;

  const rules = voiceStudioRules((await readLexicon(lang)).entries, lang);
  const compiled = {
    stamp,
    apply: compileVoiceStudioLexicon(rules),
    version:
      rules.length === 0
        ? null
        : `voicestudio:${crypto.createHash("sha256").update(JSON.stringify(rules)).digest("hex").slice(0, 16)}`,
  };
  lexicons.set(lang, compiled);
  return compiled;
}

/** Apply the active Spoken lexicon and return the version used for take provenance. */
export async function applyVoiceStudioLexicon(
  text: string,
  lang: Lang,
): Promise<{ text: string; version: string | null }> {
  const lexicon = await voiceStudioLexicon(lang);
  return { text: lexicon.apply(text), version: lexicon.version };
}

export function clearVoiceStudioLexiconCache(): void {
  lexicons.clear();
}

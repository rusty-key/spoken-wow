/**
 * The pronunciation rules VoiceStudio receives in its text.
 *
 * VoiceStudio's service does not share Spoken's database, so the lexicon is applied before the
 * request, the way fish.audio's is: the same entries and the same whole-name matching. Only the
 * phoneme syntax differs, OmniVoice's bracketed CMU phonemes.
 */
import crypto from "node:crypto";

import type { Lang } from "@/lib/lang";

import { lexiconStamp, readLexicon } from "./dictionary";
import { compileFishLexicon, fishRules, type FishRule } from "./fish-lexicon";
import type { LexiconEntry } from "./lexicon";

type CompiledLexicon = {
  stamp: string | null;
  apply: (text: string) => string;
  version: string | null;
};

const lexicons = new Map<Lang, CompiledLexicon>();

export function voiceStudioRules(entries: LexiconEntry[], lang: Lang): FishRule[] {
  return fishRules(entries, lang, (arpabet) => `[${arpabet}]`);
}

/** A language's lexicon, rebuilt only when it changes; `version` is recorded with each take. */
export async function voiceStudioLexicon(lang: Lang): Promise<CompiledLexicon> {
  const stamp = await lexiconStamp(lang);
  const cached = lexicons.get(lang);
  if (cached && cached.stamp === stamp) return cached;

  const rules = voiceStudioRules((await readLexicon(lang)).entries, lang);
  const compiled = {
    stamp,
    apply: compileFishLexicon(rules),
    version:
      rules.length === 0
        ? null
        : `voicestudio:${crypto.createHash("sha256").update(JSON.stringify(rules)).digest("hex").slice(0, 16)}`,
  };
  lexicons.set(lang, compiled);
  return compiled;
}

/**
 * What a voice clone is called in the ElevenLabs account, per language.
 *
 * The slot is shared -- dwarf-male-grim is the same NPC voice set in every language -- but
 * the clone is not: a German slot is cloned from German clips. English's clones keep the names they have always had, so
 * nothing already in the account moves; another language's carries its code after an @,
 * `dwarf-male-grim@deDE`, which no slot name can contain.
 *
 * Client-safe: the voices page shows these.
 */
import { BASE_LANG, isLang, type Lang } from "@/lib/lang";

export function cloneName(voice: string, lang: Lang): string {
  return lang === BASE_LANG ? voice : `${voice}@${lang}`;
}

/** The slot and language a clone's name stands for, or null for a name that is neither. */
export function parseCloneName(name: string): { voice: string; lang: Lang } | null {
  const parts = name.split("@");
  if (parts.length === 1) return { voice: name, lang: BASE_LANG };
  if (parts.length !== 2) return null;
  const [voice, lang] = parts;
  // An explicit English suffix is not a name this app writes, and reading it as English
  // would let two clones claim the same slot.
  if (!isLang(lang) || lang === BASE_LANG) return null;
  return { voice, lang };
}

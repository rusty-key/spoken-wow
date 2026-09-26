/**
 * Which characters make a line unvoiceable.
 *
 * This was a mirror of INVALID_CHARS in tts_cli/corpus.py and is no longer one. The character
 * list still matches, but the web app now voices every bracketed span - a capitalised stage
 * direction goes to a narrator, a lowercase sound becomes an ElevenLabs audio tag
 * (lib/generation/narration.ts) - and the Python CLI can do neither. A line the CLI calls
 * unvoiceable may therefore be voiceable here. That divergence is deliberate and joins the
 * other one CLAUDE.md records: the CLI sends no pronunciation dictionary either.
 *
 * The corpus's own `generatable` flag is baked in at extraction time, from text nobody could
 * edit yet. Now that a line's spoken text can be overridden - and that a direction can be
 * narrated - the same question has to be answerable here, against the text that will be sent.
 *
 * `$` starts a template token the game expands and we do not - `$2113w` is a war-effort tally,
 * `$Gmale:female;` a branch - and a model asked to read one says "dollar twenty-one thirteen
 * w". A bare `<` or `>` is a bracket nobody can speak.
 *
 * No node imports: the override dialog checks a draft before sending it, and the server checks
 * the copy that counts.
 */

import { BASE_LANG, type Lang } from "./lang";
import { speakPlayerTokens } from "./player-words";

/** Kept as a string, character for character, so the two files can be diffed by eye. */
export const INVALID_CHARS = "$<>";

/**
 * A balanced bracketed span, which something voices.
 *
 * Both kinds are handled by lib/generation/narration.ts before synthesis: a capitalised span is
 * a stage direction the narrator speaks, and a lowercase one is a sound the NPC makes, rewritten
 * into ElevenLabs' `[hic]` audio-tag form. Neither reaches a voice as an angle bracket, so
 * neither is damage. An unbalanced `<` still is.
 */
const DIRECTION = /<[^<>]*>/g;

export function hasInvalidChars(text: string): boolean {
  const spoken = text.replace(DIRECTION, "");
  return [...INVALID_CHARS].some((c) => spoken.includes(c));
}

/**
 * Whether a line would be voiced, given the text that would be sent.
 *
 * `invalid-chars` is a property of the text, so it is re-decided here rather than trusted from the corpus: that
 * is what lets an override rescue the 99 lines the extractor had to give up on.
 *
 * `untranslated` is a language with no text for the line: what the row carries is the
 * English, shown so the explorer has something to show, and voicing it would file an English
 * recording under another language.
 */
export function isVoiceable(
  line: { skipReason: string | null; lang?: Lang; playerGender?: "m" | "f" | null },
  effectiveText: string,
): boolean {
  if (line.skipReason === "untranslated") return false;
  // Judged on what would be sent: a translation's $N is spoken as its language's word
  // (player-words.ts), so it is not what stops the line.
  const spoken = speakPlayerTokens(effectiveText, line.lang ?? BASE_LANG, line.playerGender ?? null);
  return !hasInvalidChars(spoken);
}

/**
 * Why a quest line written here would not be voiced, or null: the extract's own rule
 * (tts_cli/corpus.py _skip_reason), for text the extract never saw -- a translation typed on
 * the site or accepted from a player. Asked of the text as it is spoken in `lang`, as
 * isVoiceable asks it.
 */
export function skipReasonFor(
  text: string,
  lang: Lang = BASE_LANG,
  playerGender: "m" | "f" | null = null,
): "invalid-chars" | null {
  return hasInvalidChars(speakPlayerTokens(text, lang, playerGender)) ? "invalid-chars" : null;
}

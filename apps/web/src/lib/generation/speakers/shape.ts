/**
 * How each provider is sent a line, before the lexicon: the one function regenerate.ts and
 * the staleness check must agree on.
 *
 * A table keyed by provider rather than a Speaker method, because staleness judges takes by
 * whichever provider made them, with no Speaker -- and no key -- in hand. A take is compared
 * against its own provider's shaping, so it never reads as stale because another provider
 * would be sent the line differently.
 */
import { accentTagged, audioTags, voiceAfter } from "../narration";
import type { Provider } from "../providers";

/**
 * Audio tags as brackets, and the race's accent direction in front of the NPC's words. Last,
 * so the direction sits before the words rather than before a `<hic>` not yet rewritten.
 */
function bracketed(
  text: string,
  raceTag: string | undefined,
  raceTags?: Record<string, string>,
  voice?: string,
): string {
  return accentTagged(audioTags(text), raceTag, raceTags, voice);
}

/**
 * How a paragraph break reaches fish-tts.ts, which speaks each paragraph on its own: every run
 * of whitespace holding a newline becomes exactly this, and every other run one space.
 */
export const PARAGRAPH_BREAK = "\n";

/**
 * fish.audio's S2 models fill a paragraph break with a sound nobody asked for -- a laugh, a
 * moan, a mumble -- in roughly a third of takes: tried on twelve esMX lines, three draws each,
 * 10 such sounds with the breaks sent and none with them flattened. So a break is never sent;
 * fish-tts.ts splits the line at PARAGRAPH_BREAK and joins the parts with a silence. The
 * break stays in the shaped text because that is where fish-tts.ts finds it, and because
 * moving one is then a text change the staleness check sees.
 *
 * Each paragraph is shaped on its own, so each opens with the race's accent direction: it
 * will be a request of its own, and a direction in an earlier one does not carry over. A voice
 * marker does carry over: it hands the rest of the line to its slot, paragraphs included, so
 * each paragraph is shaped knowing who is speaking when it starts.
 */
function paragraphed(
  text: string,
  raceTag: string | undefined,
  raceTags?: Record<string, string>,
): string {
  let voice: string | undefined;
  return text
    .split(/\s*\n\s*/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => {
      const shaped = bracketed(paragraph, raceTag, raceTags, voice);
      voice = voiceAfter(paragraph, voice);
      return shaped;
    })
    .join(PARAGRAPH_BREAK);
}

// fish.audio's S2 models read [bracketed] cues as directions too, so it is shaped the same
// way until listening shows which of them it performs.
//
// `raceTag` is the line's own slot's direction (directionFor); `raceTags` is the whole map, for
// a stretch a voice marker hands to another slot.
export const SHAPE: Record<
  Provider,
  (text: string, raceTag: string | undefined, raceTags?: Record<string, string>) => string
> = {
  elevenlabs: bracketed,
  fish: paragraphed,
};

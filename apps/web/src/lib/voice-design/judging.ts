/**
 * What both judges of What's different share: the rules their prompts state the same way, and the
 * shape their answers are read into.
 */
import { EFFECT_WORDS, PROMPT_ENDING, SIBILANT_WORDS } from "./limits";

/** Consonant wording and the old studio sentence make every s harsh; effects come out badly. */
const quoted = (words: readonly string[]) => words.map((word) => `"${word}"`).join(", ");
export const DRAFTING_RULES = `- Never describe consonants or sibilants (no ${quoted(SIBILANT_WORDS)}): it makes every s harsh.
- Never describe post-processing (${EFFECT_WORDS.join(", ")}, filters). Describe a clean voice.
- End the prompt exactly with: "${PROMPT_ENDING}"`;

/** How much an aspect's difference matters for directing the voice. */
export type Weight = "high" | "medium" | "low";

export const WEIGHTS: readonly Weight[] = ["high", "medium", "low"];

export type Aspect = { aspect: string; live: string; new: string; reference?: string; matters?: Weight };

export type Difference = {
  summary: string;
  /** The difference that matters most, as an observation of how the new voice sounds. */
  note: string;
  /** The same point as what the next version should do: the reviewer edits it into the note. */
  wish: string;
  aspects: Aspect[];
};

/**
 * Told only "compare", a judge treats the game reference as the ideal and finds the live take
 * lacking. The live take is what the team chose; the reference only says what kind of character it is.
 */
export const TARGET_RULE = `The live take is the target: it is how this character should sound, and the designed version should sound like it. Judge the designed version against it. Never criticise the live take or say it lacks anything. The game reference is the original actor, processed by the game: background only, for what kind of character this is. Where the reference and the live take differ, the live take wins: never ask the designed version for something the live take does not have.`;

export const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** A judge's aspects, checked: ones missing a side are dropped, an empty reference or unknown weight left out. */
export function parseAspects(value: unknown): Aspect[] {
  return (Array.isArray(value) ? (value as Record<string, unknown>[]) : [])
    .filter((a) => text(a?.aspect) && typeof a.live === "string" && typeof a.new === "string")
    .map((a) => ({
      aspect: text(a.aspect),
      live: text(a.live),
      new: text(a.new),
      ...(text(a.reference) ? { reference: text(a.reference) } : {}),
      ...(WEIGHTS.includes(a.matters as Weight) ? { matters: a.matters as Weight } : {}),
    }));
}


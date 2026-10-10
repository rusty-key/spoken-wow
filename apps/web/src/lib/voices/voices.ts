/**
 * The shape of a voice's name, and the model slots that are voices by pattern.
 *
 * The roster -- every type, gender and flavor, and the voice each combination is read by -- is
 * migration 0071's tables, read through roster-store.ts and asked through roster.ts.
 *
 * A flavor is which of a race-gender's NPC voice sets an NPC speaks with -- tts_cli/flavors.py
 * recovers it from the game's sound entry names, like OrcMaleShadyNPCGreetings.
 *
 * Free of imports on purpose: client components read it.
 */
export type Gender = "male" | "female";

export const GENDERS: readonly Gender[] = ["female", "male"];

/**
 * A voice keyed by a creature's model rather than a race: `model-{ModelID}`.
 *
 * A creature whose display has no race or sex -- Kum'isha the Collector, a Broken; the OOX
 * robots -- is voiced by the model it is drawn with, and every NPC on one model shares the
 * slot (tts_cli/flavors.py model_voice). The corpus carries the slot as the line's race, with
 * a placeholder gender and no flavor, and the slot alone as its voice.
 *
 * Accepted by pattern rather than listed: there is one per model, and which voice each gets
 * is not chosen yet, so they are left out of the roster -- and so of /voices, the filters and
 * the triage selects -- and their lines are refused for generation (text-gate.ts). The
 * pattern is digits after a fixed prefix, so it is as safe a path segment as a roster name.
 */
const MODEL_VOICE = /^model-\d+$/;

export function isModelVoice(name: string): boolean {
  return MODEL_VOICE.test(name);
}

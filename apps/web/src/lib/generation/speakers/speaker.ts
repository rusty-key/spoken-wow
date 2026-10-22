/**
 * Who makes the audio.
 *
 * Every take used to come from ElevenLabs by construction: the callers built ElevenLabs
 * payloads, resolved ElevenLabs voice ids and recorded ElevenLabs settings. A Speaker is
 * what those callers need from a provider and nothing more, so a second one can stand
 * behind the same three callers (regenerate.ts, narrated.ts and, later, preview.ts)
 * without any of them learning its name.
 *
 * What stays with the callers is everything that is about the line rather than the
 * provider: which text, whose voice slot, the seed, the lock, the take. What moves here is
 * everything a provider decides for itself: its model and settings, its dictionary, how
 * several voices become one file, and what a missing voice is called.
 */
import type { Lang } from "@/lib/lang";

import type { Failure } from "../errors";
import type { SeedStrategy } from "../config";
import type { Provider } from "../providers";
import type { WordStart } from "../word-times";

export type { Provider } from "../providers";

/** One voice speaking one stretch of the line. A line with a stage direction has two. */
export type Turn = {
  text: string;
  /** From `voices()`: whatever the provider speaks this slot with. */
  voiceId: string;
};

export type SpeakRequest = {
  turns: Turn[];
  lang: Lang;
  seed: number | null;
  /**
   * Whether the line holds narration or a voice marker. A line that is all stage direction,
   * or all one marked slot, is one turn and still this, so it is not `turns.length > 1`.
   */
  dialogue: boolean;
};

/**
 * What a take was made with, as its row records it.
 *
 * Returned by the provider rather than assembled by the caller, because only the provider
 * knows what it actually sent: ElevenLabs' dialogue endpoint takes stability alone, and a
 * row claiming the other settings would describe a take that never had them.
 */
export type Made = {
  modelId: string;
  settings: Record<string, unknown>;
  outputFormat: string;
  dictionaryId: string | null;
  dictionaryVersion: string | null;
};

export type Spoken =
  | {
      ok: true;
      /** Already trimmed of any lead-in: the audio to keep. */
      audio: Buffer;
      leadIn: boolean;
      leadInSec: number | null;
      /** ElevenLabs credits, exactly as billed. null when the provider did not say. */
      credits: number | null;
      /**
       * fish.audio's cost in dollars. Never folded into `credits`: a sum that added dollars
       * to credits would be wrong without looking wrong.
       */
      costUsd: number | null;
      /**
       * Each spoken word's start in `audio`, from a provider that says. Absent or null, the
       * take is stored without times and the captions estimate them.
       */
      words?: WordStart[] | null;
      made: Made;
    }
  | { ok: false; failure: Failure };

export type Voices = {
  /** Voice slot to what `speak` takes, for one language. */
  ids: ReadonlyMap<string, string>;
  /** Why the roster could not be read, if it could not. Reported, never thrown. */
  error: string | null;
};

export interface Speaker {
  readonly provider: Provider;
  /** The model lines are generated with, which also sizes the provider's concurrency. */
  readonly modelId: string;
  /** How lines are seeded: the collaborator's choice for ElevenLabs; fish.audio has no seed. */
  readonly seedStrategy: SeedStrategy;
  /** The slots this provider can speak in `lang`, as the key in hand sees them. */
  voices(lang: Lang): Promise<Voices>;
  /** How a slot with no voice is named to the person who has to go and make one. */
  missing(voice: string): string;
  speak(request: SpeakRequest): Promise<Spoken>;
}

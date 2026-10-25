/**
 * ElevenLabs, as a Speaker.
 *
 * A wrapper and not a rewrite: the requests are still built and sent by ../tts.ts, and the
 * roster is still ../status.ts's memoised account read. What this adds is only the choices
 * the callers used to make for ElevenLabs themselves -- which of the collaborator's settings,
 * which dictionary version, and which endpoint narration goes to.
 */
import "server-only";

import { elevenLabsCode, type Lang } from "@/lib/lang";
import type { ElevenLabsOptions } from "@/lib/voices/elevenlabs";

import { currentLocator } from "../dictionary";
import { voicesIn } from "../relay";
import type { ElevenLabsSettings } from "../preference";
import { generationStatus } from "../status";
import { textToDialogue, textToSpeech } from "../tts";
import type { Speaker, SpeakRequest, Spoken, Voices } from "./speaker";

/**
 * The output format every take is cut at, recorded against it.
 *
 * A constant rather than a setting. ElevenLabs bills round(characters * rate) and the rate
 * belongs to the plan, not the request, so a smaller format saves nothing and makes a later
 * quality bump a second purchase. package-audio.sh transcodes down for the shipped pack.
 * Not sent: the request takes the API default, which is this.
 */
export const OUTPUT_FORMAT = "mp3_44100_128";

/**
 * `options` carries the key to spend with, and a stub for tests.
 *
 * The key is the caller's, never a server's: whose account this is decides which voices
 * exist, and resolving a slot against somebody else's would hand ElevenLabs an id the
 * spending account does not own.
 */
export function elevenLabsSpeaker(
  options: ElevenLabsOptions & {
    settings: ElevenLabsSettings;
    /** The account's clones by name, when they were listed elsewhere (../relay.ts). */
    roster?: ReadonlyMap<string, string>;
  },
): Speaker {
  // The collaborator's own (see preference.ts).
  const config = options.settings;
  return {
    provider: "elevenlabs",
    modelId: config.modelId,
    seedStrategy: config.seedStrategy,

    async voices(lang: Lang): Promise<Voices> {
      if (options.roster) return { ids: voicesIn(options.roster, lang), error: null };
      // The account, not the provenance table: a voice created in the ElevenLabs dashboard
      // is just as real, and refusing to notice it would block a usable voice.
      const status = await generationStatus(options, lang);
      return { ids: status.voiceIds, error: status.error };
    },

    missing(voice: string): string {
      return `no ElevenLabs voice named "${voice}"`;
    },


    async speak(request: SpeakRequest): Promise<Spoken> {
      const { turns, lang, seed, dialogue } = request;
      // Read per request, not per batch: an admin saving the lexicon mid-batch should affect
      // the lines after the save, and pinning one locator for a whole batch would record a
      // version that some of its takes were not made with.
      const dictionary = await currentLocator(lang);
      const languageCode = elevenLabsCode(lang);

      // Narration goes to the dialogue endpoint, which stitches the turns into one mp3. Two
      // calls concatenated would also play, but the joined file measures wrong, and
      // sound_length_table.lua is built from that measurement.
      const speech = dialogue
        ? await textToDialogue(
            {
              inputs: turns.map((turn) => ({ text: turn.text, voiceId: turn.voiceId })),
              modelId: config.modelId,
              stability: config.voiceSettings.stability,
              seed,
              dictionary,
              languageCode,
            },
            options,
          )
        : await textToSpeech(
            {
              voiceId: turns[0].voiceId,
              text: turns[0].text,
              modelId: config.modelId,
              voiceSettings: config.voiceSettings,
              seed,
              dictionary,
              languageCode,
            },
            options,
          );
      if (!speech.ok) return speech;

      return {
        ...speech,
        costUsd: null,
        made: {
          modelId: config.modelId,
          // What was actually sent: the dialogue endpoint takes only stability, and a row
          // claiming the other three would describe a take that never had them.
          settings: dialogue ? { stability: config.voiceSettings.stability } : config.voiceSettings,
          outputFormat: OUTPUT_FORMAT,
          dictionaryId: dictionary?.dictionaryId ?? null,
          dictionaryVersion: dictionary?.versionId ?? null,
        },
      };
    },
  };
}

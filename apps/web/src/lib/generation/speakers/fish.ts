/**
 * fish.audio, as a Speaker.
 *
 * A slot's "voice id" here is its reference's clipHash: the thing fish.audio actually clones
 * from is the clip and its transcript, so that is what a take should record. voices() reads
 * the hashes for a language and speak() loads the clips they name.
 *
 * The settings are the collaborator's own (generation_preference), not an admin's: who
 * generates with fish.audio chooses how.
 */
import "server-only";

import crypto from "node:crypto";

import type { Lang } from "@/lib/lang";
import { fishCost, type FishOptions } from "@/lib/voices/fish";
import { forgetReferences, listReferences, loadReferences } from "@/lib/voices/references";

import { lexiconStamp, readLexicon } from "../dictionary";
import { failure } from "../errors";
import { compileFishLexicon, fishRules, type FishRule } from "../fish-lexicon";
import { fishSpeech, type FishSettings } from "../fish-tts";
import type { Speaker, SpeakRequest, Spoken, Voices } from "./speaker";

/** What a fish.audio take is recorded as having been cut at: what fish-tts.ts asks for. */
export const FISH_OUTPUT_FORMAT = "mp3_44100_128";

type CompiledLexicon = { stamp: string | null; apply: (text: string) => string; version: string | null };
const lexicons = new Map<Lang, CompiledLexicon>();

/**
 * A language's lexicon as fish.audio applies it, rebuilt only when the lexicon changes.
 *
 * Checked on every line, as ElevenLabs' locator is read on every line: an edit mid-batch
 * applies to the lines after it, and each take records the rules it was made with. But the
 * check is a timestamp, and converting every entry and compiling one pattern of them all
 * happens once per edit rather than once per line of a forty-thousand-line batch.
 */
async function fishLexicon(lang: Lang): Promise<CompiledLexicon> {
  const stamp = await lexiconStamp(lang);
  const cached = lexicons.get(lang);
  if (cached && cached.stamp === stamp) return cached;
  const rules = fishRules((await readLexicon(lang)).entries, lang);
  const compiled = { stamp, apply: compileFishLexicon(rules), version: fishLexiconVersion(rules) };
  lexicons.set(lang, compiled);
  return compiled;
}

export function fishSpeaker(options: FishOptions & { settings: FishSettings }): Speaker {
  const { settings } = options;

  return {
    provider: "fish",
    modelId: settings.model,
    // fish.audio takes no seed, so there is nothing to hold steady.
    seedStrategy: "none",

    async voices(lang: Lang): Promise<Voices> {
      const references = await listReferences(lang);
      return {
        ids: new Map([...references].map(([voice, reference]) => [voice, reference.clipHash])),
        error: null,
      };
    },

    missing(voice: string): string {
      return `no fish.audio reference for "${voice}"`;
    },


    async speak({ turns, lang }: SpeakRequest): Promise<Spoken> {
      // One speaker per distinct voice, in order of first appearance: the NPC is speaker 0
      // and the narrator 1, whichever of them opens the line.
      const speakers = [...new Set(turns.map((turn) => turn.voiceId))];
      const { clips, lost } = await loadReferences(lang, speakers);
      if (lost.length) {
        // The row is there and its clip is not: a lost directory, not a race. Every line
        // that uses the slot will fail the same way, so this one stops the batch, and says
        // which slot to re-cut.
        return {
          ok: false,
          failure: failure(
            "voice-missing",
            `the fish.audio reference clip for ${lost.map((voice) => `"${voice}"`).join(" and ")} ` +
              "is missing on disk; cut it again on /voices",
          ),
        };
      }
      if (!speakers.every((hash) => clips.has(hash))) {
        // The hash voices() handed out no longer matches: the reference was re-cut or
        // corrected since, perhaps in the other app process, whose write did not clear this
        // one's memo. Refused rather than spoken from whatever is there now, which would
        // record a voice id the audio was not made from -- but as one line's failure, not the
        // batch's, and with the memo dropped so the next line resolves the new reference.
        forgetReferences(lang);
        return {
          ok: false,
          failure: failure(
            "upstream",
            "a fish.audio reference changed while this line was being generated; try again",
          ),
        };
      }

      const lexicon = await fishLexicon(lang);

      const speech = await fishSpeech(
        {
          turns: turns.map((turn) => ({
            text: lexicon.apply(turn.text),
            speaker: speakers.indexOf(turn.voiceId),
          })),
          references: speakers.map((hash) => clips.get(hash)!),
          settings,
        },
        options,
      );
      if (!speech.ok) return speech;

      return {
        ok: true,
        audio: speech.audio,
        // No lead-in: fish.audio has not been shown to need one.
        leadIn: false,
        leadInSec: null,
        credits: null,
        costUsd: fishCost(settings.model, speech.bytes),
        // fish.audio's /v1/tts returns audio only; its timed endpoint streams.
        words: null,
        made: {
          modelId: settings.model,
          settings: { temperature: settings.temperature, top_p: settings.topP, speed: settings.speed },
          outputFormat: FISH_OUTPUT_FORMAT,
          // There is no dictionary on fish.audio's side; the version names the rules applied.
          dictionaryId: null,
          dictionaryVersion: lexicon.version,
        },
      };
    },
  };
}

/**
 * What a fish.audio take records as its dictionaryVersion: which lexicon made it.
 *
 * A digest of the rules actually applied rather than of the stored entries, so an edit
 * fish.audio cannot use (another language's IPA) does not look like a change to its takes.
 */
export function fishLexiconVersion(rules: FishRule[]): string | null {
  if (rules.length === 0) return null;
  const digest = crypto.createHash("sha256").update(JSON.stringify(rules)).digest("hex");
  return `fish:${digest.slice(0, 16)}`;
}

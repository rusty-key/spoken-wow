/**
 * Turning a line's text into an mp3.
 *
 * The only generator there is. The Python CLI had its own, synthesize.py, whose payload
 * this still matches -- same model, same voice_settings object, same optional seed, and no
 * output_format -- because much of the archive was cut by it, and the addon resolves a
 * sound by filename and cannot tell which made it. That generator is retired: every take
 * is cut here, by the site.
 *
 * Two fields synthesize.py did not send, and both are deliberate: the pronunciation
 * dictionary, and language_code. The version row records the model and the dictionary
 * version, which is what makes the difference visible after the fact.
 *
 * `fetch` and the base URL are injectable: no test should need an account, and none should
 * ever spend money.
 */
import {
  DEFAULT_BASE_URL,
  type DictionaryLocator,
  type ElevenLabsOptions,
} from "@/lib/voices/elevenlabs";

import type { VoiceSettings } from "./config";
import { classifyUpstream, failure, type Failure } from "./errors";
import { trimLeadIn, withLeadIn } from "./leadin";
import { wordStarts, type Alignment, type WordStart } from "./word-times";

/**
 * The language a request says it is in, when the caller names none: English, the corpus
 * every line was written in first.
 *
 * ElevenLabs describes language_code as enforcing a language "for the model and text
 * normalization". Without it a multilingual model infers the language from the text, and a
 * short input gives it almost nothing to go on - a bare name in a preview gives it nothing at
 * all, which is how a word preview comes back with the wrong language's vowels. It also plausibly
 * governs how a phoneme string is read, since an IPA symbol means different things under
 * different phonologies.
 */
export const CORPUS_LANGUAGE = "en";

/**
 * Models that accept language_code. Others are sent none.
 *
 * A list rather than a guess, and it errs toward omitting: leaving the field off is exactly
 * today's behaviour, so a model missing from here loses nothing, while sending it to a model
 * that rejects it would fail a request that used to work. multilingual_v2 is documented as
 * not supporting it.
 */
export const LANGUAGE_MODELS = ["eleven_v3", "eleven_flash_v2_5", "eleven_turbo_v2_5"] as const;

export function acceptsLanguage(modelId: string): boolean {
  return (LANGUAGE_MODELS as readonly string[]).includes(modelId);
}

export type SpeechRequest = {
  voiceId: string;
  /** Already normalised by applyPronunciation; this function does not touch it. */
  text: string;
  modelId: string;
  voiceSettings: VoiceSettings;
  seed: number | null;
  /**
   * The pronunciation dictionary to apply, or null for none.
   *
   * Null is what the retired Python generator always sent, so a take it cut and a take cut
   * here can differ in pronunciation even with identical settings -- which is why the
   * locator is recorded against every take.
   */
  dictionary?: DictionaryLocator | null;
  /**
   * ISO 639-1, as the API takes it: "pt" for ptBR (lib/lang's elevenLabs code). English when
   * absent, so every caller that predates languages sends what it always sent.
   */
  languageCode?: string;
};

/**
 * Several voices, one file.
 *
 * Used when a line carries a stage direction: the NPC speaks its own words and a narrator
 * reads the bracketed part, and ElevenLabs stitches the turns into a single mp3. Two calls
 * concatenated would also play, but the joined file measures wrong - mutagen reads the first
 * clip's header and stops - and sound_length_table.lua is built from that measurement.
 */
export type DialogueRequest = {
  inputs: { text: string; voiceId: string }[];
  modelId: string;
  /** The only setting the endpoint documents. See buildDialoguePayload. */
  stability: number;
  seed: number | null;
  dictionary?: DictionaryLocator | null;
  /**
   * ISO 639-1, as the API takes it: "pt" for ptBR (lib/lang's elevenLabs code). English when
   * absent, so every caller that predates languages sends what it always sent.
   */
  languageCode?: string;
};

export type SpeechResult =
  | {
      ok: true;
      /** Already trimmed of its lead-in, if the model took one. See ./leadin. */
      audio: Buffer;
      /** Whether a lead-in was sent, and how many seconds were cut back off. */
      leadIn: boolean;
      leadInSec: number | null;
      /**
       * What the request actually cost, from the `character-cost` response header.
       *
       * Not the length of the text. ElevenLabs bills round(characters x rate), and the rate
       * is a property of the plan rather than the request: measured at 0.55 on this account
       * for the standard models and half that for flash and turbo, so 310 characters cost
       * 170. Reading the header is the only way to know without guessing at someone's plan,
       * and it agreed with the usage-stats delta on every model and length tried.
       *
       * null when the header is absent, which is a reason to stop reporting a number rather
       * than to invent one.
       */
      credits: number | null;
      /**
       * Each spoken word's start in the trimmed audio, or null when ElevenLabs sent no
       * alignment. These are the words that were sent, tags left out; ./word-times lays them
       * onto the words the addon shows.
       */
      words: WordStart[] | null;
    }
  | { ok: false; failure: Failure };

/** The exact cost of a request, or null if ElevenLabs did not say. */
export function creditsFrom(headers: Headers): number | null {
  const raw = headers.get("character-cost");
  if (raw === null) return null;
  const credits = Number(raw);
  return Number.isFinite(credits) && credits >= 0 ? credits : null;
}

export function buildPayload(request: SpeechRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    // The lead-in belongs here for the reason language_code does: it is a constant derived
    // from the model, so every caller should get it and none should have to remember it.
    // preview.ts is why that matters - it audition a single sentence, which is the request
    // most damaged by the ramp-up, and it would never have thought to ask.
    text: withLeadIn(request.text, request.modelId),
    model_id: request.modelId,
    voice_settings: request.voiceSettings,
  };
  // Omitted rather than sent as null when the strategy is "none": Python omits the key, and
  // a null seed is a value ElevenLabs would have to interpret.
  if (request.seed !== null) payload.seed = request.seed;
  // Not recorded on the take as a field of its own: it is the take's language (take.lang)
  // spelled the way the API wants, sent whenever the model -- which IS recorded -- takes it.
  if (acceptsLanguage(request.modelId)) {
    payload.language_code = request.languageCode ?? CORPUS_LANGUAGE;
  }
  // Same reasoning for the dictionary, and the version id is not optional: naming the
  // dictionary without a version would let a later upload change how an already-recorded
  // take would sound, which is the thing dictionaryVersion exists to pin down.
  if (request.dictionary) {
    payload.pronunciation_dictionary_locators = [
      {
        pronunciation_dictionary_id: request.dictionary.dictionaryId,
        version_id: request.dictionary.versionId,
      },
    ];
  }
  return payload;
}

/**
 * The dialogue payload.
 *
 * Only `stability` is sent. The endpoint's settings object documents nothing else, and
 * similarity_boost, style and use_speaker_boost would be sent only to be ignored - which the
 * version row would then record as though they had applied.
 */
export function buildDialoguePayload(request: DialogueRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    // Lead-in on the first turn only: the settling happens once, at the top of the file, and
    // a throat clear between turns would be heard rather than trimmed.
    inputs: request.inputs.map((input, index) => ({
      text: index === 0 ? withLeadIn(input.text, request.modelId) : input.text,
      voice_id: input.voiceId,
    })),
    model_id: request.modelId,
    settings: { stability: request.stability },
  };
  if (request.seed !== null) payload.seed = request.seed;
  if (acceptsLanguage(request.modelId)) {
    payload.language_code = request.languageCode ?? CORPUS_LANGUAGE;
  }
  if (request.dictionary) {
    payload.pronunciation_dictionary_locators = [
      {
        pronunciation_dictionary_id: request.dictionary.dictionaryId,
        version_id: request.dictionary.versionId,
      },
    ];
  }
  return payload;
}

/**
 * Total characters across every turn, which is what the endpoint's limit counts.
 *
 * Measured off the built payload rather than the request, so the lead-in is counted. The
 * limit is about what the endpoint receives, and a check that ignored the prefix would be
 * measuring a payload nobody sends.
 */
export function dialogueCharacters(request: DialogueRequest): number {
  const { inputs } = buildDialoguePayload(request) as { inputs: { text: string }[] };
  return inputs.reduce((sum, input) => sum + input.text.length, 0);
}

/**
 * One audio request, whichever endpoint it goes to.
 *
 * Shared so that speech and dialogue cannot drift apart on the things that matter equally to
 * both: an error served with 200, an empty body, and where the credit count comes from.
 */
async function requestAudio(
  path: string,
  payload: Record<string, unknown>,
  modelId: string,
  options: ElevenLabsOptions,
): Promise<SpeechResult> {
  // The caller's own key, never a server-wide one: see config() in lib/voices/elevenlabs.ts.
  // "auth" is the right kind because it is fatal to a batch - every later job in it would
  // fail the same way, and the queue stops rather than marching through the rest.
  const { apiKey } = options;
  if (!apiKey) {
    return { ok: false, failure: failure("auth", "no ElevenLabs key was supplied for this request") };
  }

  const baseUrl = options.baseUrl ?? process.env.ELEVENLABS_BASE_URL ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // DNS, TLS, a dropped connection: not a batch-stopping condition, because the next line
    // may well succeed.
    return {
      ok: false,
      failure: failure("upstream", `could not reach ElevenLabs: ${message(error)}`),
    };
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    return { ok: false, failure: classifyUpstream(response.status, raw, "generating the line") };
  }

  // It earns its place: an error served with a 200 would otherwise be archived as an mp3
  // and play as silence in the game.
  const raw = await response.text().catch(() => "");
  const body = timedAudio(raw);
  if (!body) {
    const contentType = response.headers.get("content-type") || "no content type";
    return {
      ok: false,
      failure: failure(
        "upstream",
        `ElevenLabs answered 200 with ${contentType} rather than audio: ${raw.slice(0, 200)}`,
      ),
    };
  }

  const credits = creditsFrom(response.headers);
  const received = Buffer.from(body.audio_base64, "base64");
  if (received.byteLength === 0) {
    return { ok: false, failure: failure("upstream", "ElevenLabs returned an empty response") };
  }

  // Trimmed here rather than by each caller, so what comes out of this module is always the
  // audio to keep. Never throws: a take that cannot be trimmed is still a take worth storing.
  const { audio, leadIn, leadInSec } = await trimLeadIn(received, modelId);
  // The alignment is of the audio as it arrived, so its times move with the cut.
  const breaks = (body.voice_segments ?? []).map((segment) => segment.character_start_index);
  const words = body.alignment
    ? wordStarts(body.alignment, breaks).map((word) => ({
        ...word,
        start: word.start - (leadInSec ?? 0),
      }))
    : null;
  return { ok: true, audio, leadIn, leadInSec, credits, words };
}

/** What the with-timestamps endpoints answer. */
type TimedAudio = {
  audio_base64: string;
  alignment?: Alignment | null;
  /** Dialogue only: which characters each turn spoke. */
  voice_segments?: { character_start_index: number }[];
};

/** Unaligned and at no cost: the stand-in answer a run that only records its requests hears back. */
export function timedAudioAnswer(audio: Buffer): Response {
  const body: TimedAudio = { audio_base64: audio.toString("base64"), alignment: null };
  return Response.json(body, { headers: { "character-cost": "0" } });
}

function timedAudio(raw: string): TimedAudio | null {
  try {
    const body = JSON.parse(raw) as Partial<TimedAudio> | null;
    return body && typeof body.audio_base64 === "string" ? (body as TimedAudio) : null;
  } catch {
    return null;
  }
}

export async function textToSpeech(
  request: SpeechRequest,
  options: ElevenLabsOptions = {},
): Promise<SpeechResult> {
  return requestAudio(
    `/v1/text-to-speech/${request.voiceId}/with-timestamps`,
    buildPayload(request),
    request.modelId,
    options,
  );
}

/** The documented ceiling across all turns. Worth asserting rather than discovering. */
const DIALOGUE_MAX_CHARACTERS = 2_000;

export async function textToDialogue(
  request: DialogueRequest,
  options: ElevenLabsOptions = {},
): Promise<SpeechResult> {
  const characters = dialogueCharacters(request);
  if (characters > DIALOGUE_MAX_CHARACTERS) {
    // The longest affected corpus line is 515 characters, so this is a tripwire for a line
    // that grew or an override that ran away, not a case to chunk around.
    return {
      ok: false,
      failure: failure(
        "bad-request",
        `dialogue is ${characters} characters, over the ${DIALOGUE_MAX_CHARACTERS} the endpoint accepts`,
      ),
    };
  }
  return requestAudio(
    "/v1/text-to-dialogue/with-timestamps",
    buildDialoguePayload(request),
    request.modelId,
    options,
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

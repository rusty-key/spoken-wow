/**
 * VoiceStudio, as a Speaker.
 *
 * VoiceStudio exposes an OpenAI-compatible API rather than a metered cloud account. Each
 * collaborator connects their own service on /profile (voicestudio-connection.ts), and its
 * optional key is sent as a bearer token. Profiles are matched by the same names Spoken uses
 * everywhere else: `slot` in English and `slot@lang` for another locale.
 */
import "server-only";

import { parseCloneName } from "@/lib/voices/clone-name";
import { isVoiceSlot } from "@/lib/voices/slots";
import type { Lang } from "@/lib/lang";

import { failure, classifyUpstream } from "../errors";
import { stitchMp3 } from "../stitch";
import type { VoiceStudioConnection } from "../voicestudio-connection";
import { applyVoiceStudioLexicon } from "../voicestudio-lexicon";
import type { Speaker, SpeakRequest, Spoken, Voices } from "./speaker";

export const VOICESTUDIO_OUTPUT_FORMAT = "mp3";
export const VOICESTUDIO_TURN_PAUSE_SEC = 0.25;

// A listing that takes longer than this is a service that is down or asleep, and /voices and
// the status route wait on it. Speech gets longer: a cold model can take a while on a turn.
const LIST_TIMEOUT_MS = 10_000;
const SPEECH_TIMEOUT_MS = 180_000;

export type VoiceStudioOptions = Pick<VoiceStudioConnection, "baseUrl" | "model"> &
  Partial<Pick<VoiceStudioConnection, "apiKey">> & {
    fetchImpl?: typeof globalThis.fetch;
  };

type VoiceProfile = { id?: string; voice_id?: string; name?: string };

function config(options: VoiceStudioOptions) {
  return {
    apiKey: options.apiKey ?? "",
    baseUrl: options.baseUrl,
    modelId: options.model,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  };
}

// No redirects: the URL was checked when it was saved, and a redirect is how a public host
// would hand the request on to one that was not.
function request(timeoutMs: number): Pick<RequestInit, "redirect" | "signal" | "cache"> {
  return { redirect: "error", signal: AbortSignal.timeout(timeoutMs), cache: "no-store" };
}

async function fetchProfiles(options: VoiceStudioOptions): Promise<VoiceProfile[]> {
  const { apiKey, baseUrl, fetchImpl } = config(options);
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/audio/voices`, {
      headers: headers(apiKey),
      ...request(LIST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`could not reach VoiceStudio: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const issue = await upstreamFailure(response, "listing VoiceStudio voices");
    throw new Error(issue.message);
  }
  const body = (await response.json().catch(() => null)) as { voices?: VoiceProfile[] } | null;
  if (!body || !Array.isArray(body.voices)) {
    throw new Error("VoiceStudio answered the voice list with something that is not one");
  }
  return body.voices;
}

/** Whether a connection answers, for /profile before it stores one. Throws why not. */
export async function checkVoiceStudio(
  connection: VoiceStudioConnection,
  fetchImpl?: typeof globalThis.fetch,
): Promise<void> {
  await fetchProfiles({ ...connection, fetchImpl });
}

function headers(apiKey: string, json = false): Record<string, string> {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function upstreamFailure(response: Response, what: string) {
  const raw = await response.text().catch(() => "");
  return classifyUpstream(response.status, raw, what);
}

async function listProfiles(options: VoiceStudioOptions, lang: Lang): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>();
  for (const profile of await fetchProfiles(options)) {
    const name = profile.name;
    const id = profile.voice_id ?? profile.id ?? name;
    if (!name || !id) continue;
    const clone = parseCloneName(name);
    if (clone?.lang === lang && (await isVoiceSlot(clone.voice))) {
      found.set(clone.voice, id);
    }
  }
  return found;
}

function instruction(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const plain = text.replace(/\[([^\]]+)\]/g, "$1").trim();
  return plain || undefined;
}

export function voiceStudioSpeaker(options: VoiceStudioOptions): Speaker {
  const configForSpeaker = config(options);
  return {
    provider: "voicestudio",
    modelId: configForSpeaker.modelId,
    seedStrategy: "none",

    async voices(lang: Lang): Promise<Voices> {
      try {
        return { ids: await listProfiles(options, lang), error: null };
      } catch (error) {
        return { ids: new Map(), error: error instanceof Error ? error.message : String(error) };
      }
    },

    missing(voice: string): string {
      return `no VoiceStudio profile for "${voice}" in this language`;
    },

    async speak({ turns, lang }: SpeakRequest): Promise<Spoken> {
      if (turns.length === 0) {
        return { ok: false, failure: failure("bad-request", "VoiceStudio received no speech turns") };
      }

      const { apiKey, baseUrl, modelId, fetchImpl } = configForSpeaker;
      const lexicon = await applyVoiceStudioLexiconToTurns(turns, lang);
      const parts: Buffer[] = [];
      for (const turn of lexicon.turns) {
        let response: Response;
        try {
          response = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
            method: "POST",
            headers: headers(apiKey, true),
            ...request(SPEECH_TIMEOUT_MS),
            body: JSON.stringify({
              model: modelId,
              voice: turn.voiceId,
              input: turn.text,
              response_format: VOICESTUDIO_OUTPUT_FORMAT,
              ...(instruction(turn.instructions) ? { instructions: instruction(turn.instructions) } : {}),
            }),
          });
        } catch (error) {
          return {
            ok: false,
            failure: failure(
              "upstream",
              `could not reach VoiceStudio: ${error instanceof Error ? error.message : String(error)}`,
            ),
          };
        }

        if (!response.ok) return { ok: false, failure: await upstreamFailure(response, "generating the line") };
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().startsWith("audio/")) {
          const raw = await response.text().catch(() => "");
          return {
            ok: false,
            failure: failure(
              "upstream",
              `VoiceStudio answered 200 with ${contentType || "no content type"} rather than audio: ${raw.slice(0, 200)}`,
            ),
          };
        }
        const audio = Buffer.from(await response.arrayBuffer());
        if (audio.length === 0) {
          return { ok: false, failure: failure("upstream", "VoiceStudio returned an empty response") };
        }
        parts.push(audio);
      }

      let audio: Buffer;
      try {
        audio = await stitchMp3(parts, VOICESTUDIO_TURN_PAUSE_SEC);
      } catch (error) {
        return {
          ok: false,
          failure: failure(
            "upstream",
            error instanceof Error ? error.message : `joining VoiceStudio turns failed: ${String(error)}`,
          ),
        };
      }

      return {
        ok: true,
        audio,
        leadIn: false,
        leadInSec: null,
        credits: null,
        costUsd: null,
        words: null,
        made: {
          modelId,
          settings: { response_format: VOICESTUDIO_OUTPUT_FORMAT, turns: turns.length },
          outputFormat: VOICESTUDIO_OUTPUT_FORMAT,
          dictionaryId: null,
          dictionaryVersion: lexicon.version,
        },
      };
    },
  };
}

async function applyVoiceStudioLexiconToTurns(
  turns: SpeakRequest["turns"],
  lang: Lang,
): Promise<{ turns: SpeakRequest["turns"]; version: string | null }> {
  let version: string | null = null;
  const transformed = [];
  for (const turn of turns) {
    const applied = await applyVoiceStudioLexicon(turn.text, lang);
    transformed.push({ ...turn, text: applied.text });
    version = applied.version;
  }
  return { turns: transformed, version };
}

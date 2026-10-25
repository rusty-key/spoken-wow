/**
 * VoiceStudio, as a Speaker.
 *
 * VoiceStudio exposes an OpenAI-compatible local API rather than a metered cloud account. The
 * service root is configured for the deployment, and an optional OMNIVOICE_API_KEY is sent for
 * remote backends. Profiles are matched by the same names Spoken uses everywhere else:
 * `slot` in English and `slot@lang` for another locale.
 */
import "server-only";

import { parseCloneName } from "@/lib/voices/clone-name";
import { isVoiceSlot } from "@/lib/voices/slots";
import type { Lang } from "@/lib/lang";

import { failure, classifyUpstream } from "../errors";
import { stitchMp3 } from "../stitch";
import type { Speaker, SpeakRequest, Spoken, Voices } from "./speaker";

export const VOICESTUDIO_DEFAULT_BASE_URL = "http://127.0.0.1:3900";
export const VOICESTUDIO_DEFAULT_MODEL = "omnivoice";
export const VOICESTUDIO_OUTPUT_FORMAT = "mp3";
export const VOICESTUDIO_TURN_PAUSE_SEC = 0.25;

export type VoiceStudioOptions = {
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  fetchImpl?: typeof globalThis.fetch;
};

type VoiceProfile = { id?: string; voice_id?: string; name?: string };

function config(options: VoiceStudioOptions) {
  const rawBase = options.baseUrl ?? process.env.VOICESTUDIO_BASE_URL ?? VOICESTUDIO_DEFAULT_BASE_URL;
  // The documented value is the service root. Be forgiving when an operator copies an OpenAI
  // client base URL ending in /v1, so requests do not become /v1/v1/…
  const baseUrl = rawBase.replace(/\/+$/, "").replace(/\/v1$/, "");
  return {
    apiKey: options.apiKey ?? process.env.OMNIVOICE_API_KEY ?? "",
    baseUrl,
    modelId: options.modelId ?? process.env.VOICESTUDIO_MODEL ?? VOICESTUDIO_DEFAULT_MODEL,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  };
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
  const { apiKey, baseUrl, fetchImpl } = config(options);
  const response = await fetchImpl(`${baseUrl}/v1/audio/voices`, {
    headers: headers(apiKey),
    cache: "no-store",
  });
  if (!response.ok) {
    const issue = await upstreamFailure(response, "listing VoiceStudio voices");
    throw new Error(issue.message);
  }

  const body = (await response.json()) as { voices?: VoiceProfile[] };
  const found = new Map<string, string>();
  for (const profile of body.voices ?? []) {
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

export function voiceStudioSpeaker(options: VoiceStudioOptions = {}): Speaker {
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

    async speak({ turns }: SpeakRequest): Promise<Spoken> {
      if (turns.length === 0) {
        return { ok: false, failure: failure("bad-request", "VoiceStudio received no speech turns") };
      }

      const { apiKey, baseUrl, modelId, fetchImpl } = configForSpeaker;
      const parts: Buffer[] = [];
      for (const turn of turns) {
        let response: Response;
        try {
          response = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
            method: "POST",
            headers: headers(apiKey, true),
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
          dictionaryVersion: null,
        },
      };
    },
  };
}

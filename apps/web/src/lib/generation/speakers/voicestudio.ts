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
import { loadRoster } from "@/lib/voices/roster-store";
import type { Lang } from "@/lib/lang";

import { failure, classifyUpstream, type Failure } from "../errors";
import { stitchMp3 } from "../stitch";
import { decodeConnection, type VoiceStudioConnection } from "../voicestudio-connection";
import { voiceStudioLexicon } from "../voicestudio-lexicon";
import type { Speaker, SpeakRequest, Spoken, Turn, Voices } from "./speaker";

const OUTPUT_FORMAT = "mp3";
const TURN_PAUSE_SEC = 0.25;

// A listing that takes longer than this is a service that is down or asleep, and /voices and
// the status route wait on it. Speech gets longer: a cold model can take a while on a turn.
const LIST_TIMEOUT_MS = 10_000;
const SPEECH_TIMEOUT_MS = 180_000;

type Service = Pick<VoiceStudioConnection, "baseUrl" | "apiKey" | "model">;
type Fetch = typeof globalThis.fetch;
type VoiceProfile = { id?: string; voice_id?: string; name?: string };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// No redirects: the URL was checked when it was saved, and a redirect is how a public host
// would hand the request on to one that was not.
function request(timeoutMs: number): Pick<RequestInit, "redirect" | "signal" | "cache"> {
  return { redirect: "error", signal: AbortSignal.timeout(timeoutMs), cache: "no-store" };
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

async function fetchProfiles({ baseUrl, apiKey }: Service, fetchImpl: Fetch): Promise<VoiceProfile[]> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/audio/voices`, {
      headers: headers(apiKey),
      ...request(LIST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`could not reach VoiceStudio: ${message(error)}`);
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
  fetchImpl: Fetch = globalThis.fetch,
): Promise<void> {
  await fetchProfiles(connection, fetchImpl);
}

async function listProfiles(service: Service, fetchImpl: Fetch, lang: Lang): Promise<ReadonlyMap<string, string>> {
  const [profiles, roster] = await Promise.all([fetchProfiles(service, fetchImpl), loadRoster()]);
  const slots = new Set(roster.voiceNames);
  const found = new Map<string, string>();
  for (const profile of profiles) {
    const name = profile.name;
    const id = profile.voice_id ?? profile.id ?? name;
    if (!name || !id) continue;
    const clone = parseCloneName(name);
    if (clone?.lang === lang && slots.has(clone.voice)) found.set(clone.voice, id);
  }
  return found;
}

function instruction(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const plain = text.replace(/\[([^\]]+)\]/g, "$1").trim();
  return plain || undefined;
}

async function speakTurn(
  { baseUrl, apiKey, model }: Service,
  fetchImpl: Fetch,
  turn: Turn,
): Promise<{ ok: true; audio: Buffer } | { ok: false; failure: Failure }> {
  const refused = (why: string) => ({ ok: false as const, failure: failure("upstream", why) });

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: headers(apiKey, true),
      ...request(SPEECH_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        voice: turn.voiceId,
        input: turn.text,
        response_format: OUTPUT_FORMAT,
        instructions: instruction(turn.instructions),
      }),
    });
  } catch (error) {
    return refused(`could not reach VoiceStudio: ${message(error)}`);
  }

  if (!response.ok) return { ok: false, failure: await upstreamFailure(response, "generating the line") };
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("audio/")) {
    const raw = await response.text().catch(() => "");
    return refused(
      `VoiceStudio answered 200 with ${contentType || "no content type"} rather than audio: ${raw.slice(0, 200)}`,
    );
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) return refused("VoiceStudio returned an empty response");
  return { ok: true, audio };
}

export function voiceStudioSpeaker(service: Service, fetchImpl: Fetch = globalThis.fetch): Speaker {
  return {
    provider: "voicestudio",
    modelId: service.model,
    seedStrategy: "none",

    async voices(lang: Lang): Promise<Voices> {
      try {
        return { ids: await listProfiles(service, fetchImpl, lang), error: null };
      } catch (error) {
        return { ids: new Map(), error: message(error) };
      }
    },

    missing(voice: string): string {
      return `no VoiceStudio profile for "${voice}" in this language`;
    },

    async speak({ turns, lang }: SpeakRequest): Promise<Spoken> {
      if (turns.length === 0) {
        return { ok: false, failure: failure("bad-request", "VoiceStudio received no speech turns") };
      }

      const lexicon = await voiceStudioLexicon(lang);
      const parts: Buffer[] = [];
      for (const turn of turns) {
        const part = await speakTurn(service, fetchImpl, { ...turn, text: lexicon.apply(turn.text) });
        if (!part.ok) return part;
        parts.push(part.audio);
      }

      let audio: Buffer;
      try {
        audio = await stitchMp3(parts, TURN_PAUSE_SEC);
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
          modelId: service.model,
          settings: { response_format: OUTPUT_FORMAT, turns: turns.length },
          outputFormat: OUTPUT_FORMAT,
          dictionaryId: null,
          dictionaryVersion: lexicon.version,
        },
      };
    },
  };
}

/** The profiles behind a stored connection, or why it could not be read. Never throws. */
export async function voiceStudioRoster(
  stored: string,
  lang: Lang,
): Promise<Voices & { model: string | null }> {
  try {
    const connection = decodeConnection(stored);
    return { model: connection.model, ...(await voiceStudioSpeaker(connection).voices(lang)) };
  } catch (error) {
    return { model: null, ids: new Map(), error: message(error) };
  }
}

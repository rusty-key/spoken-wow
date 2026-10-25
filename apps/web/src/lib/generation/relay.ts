/**
 * A provider request sent from an author's own machine, with a key this server never holds.
 *
 * Generation is the same code wherever the audio comes from: regenerate.ts and narrated.ts
 * build the request, tts.ts and fish-tts.ts send it, trim it, stitch it and price it, and
 * commit.ts keeps it. All of them already take `fetch` as a parameter, so a relayed job is
 * that same code run twice with a different fetch:
 *
 *   1. CLAIM. Run with a fetch that records each request and answers with a moment of
 *      silence, and a commit that stops the run before anything is kept. What it recorded
 *      is exactly what the line would send, which goes to the author's Spoken Manager.
 *   2. ANSWER. The Manager sends each request with its own key and returns what came back.
 *      Run again with a fetch that answers each request from those, and the real commit.
 *
 * Each request is matched by a fingerprint of everything in it but the key. A line whose text,
 * lexicon or reference changed between the two runs builds a different request, finds no
 * answer, and is generated again rather than committed with audio of the old text.
 */
import "server-only";

import { createHash } from "node:crypto";

import { parseCloneName } from "@/lib/voices/clone-name";
import { isVoiceSlot } from "@/lib/voices/slots";

import type { Lang } from "@/lib/lang";
import type { Provider } from "./speakers/speaker";

/** Request headers that carry a key. Never recorded, never sent to a Manager. */
const AUTH_HEADERS = new Set(["xi-api-key", "authorization"]);

/** One provider request for a Manager to send, with the key it adds itself. */
export type RelayedRequest = {
  id: string;
  provider: Provider;
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Base64. */
  body: string;
};

/** What the provider answered, or why it could not be reached. */
export type RelayedAnswer =
  | { id: string; status: number; contentType: string | null; characterCost: string | null; body: string }
  | { id: string; error: string };

type Init = { method?: string; headers?: HeadersInit; body?: BodyInit | null };

function bodyBytes(body: BodyInit | null | undefined): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  throw new Error("a relayed request's body must be text or bytes");
}

function plainHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of new Headers(headers).entries()) {
    if (!AUTH_HEADERS.has(name)) out[name] = value;
  }
  return out;
}

function providerOf(url: string): Provider {
  return new URL(url).hostname.includes("fish") ? "fish" : "elevenlabs";
}

/** Everything in a request but the key: what decides whether an answer is its answer. */
export function fingerprint(request: Omit<RelayedRequest, "id" | "provider">): string {
  const headers = Object.entries(request.headers).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify([request.method, request.url, headers]))
    .update("\0")
    .update(Buffer.from(request.body, "base64"))
    .digest("hex");
}

/**
 * A fifth of a second of silent mono mp3. What a recording run hears back, so that the
 * code after the request -- the lead-in trim, the paragraph stitch -- runs on real audio and
 * reaches the next request, as it will when the answers come.
 */
const SILENCE = Buffer.from(
  "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAJAAAEYgBBQUFBQUFBQUFBQVlZWVlZWVlZWVlZcHBwcHBwcHBwcHCIiIiIiIiIiIiIiKCgoKCgoKCgoKCguLi4uLi4uLi4uLjQ0NDQ0NDQ0NDQ0Ojo6Ojo6Ojo6Ojo//////////////8AAAAATGF2YzYwLjMxAAAAAAAAAAAAAAAAJAPMAAAAAAAABGLZ9TL5AAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVf/7EsQpg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVf/7EMRTg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBV//sSxH0DwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxKcDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xLE0IPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE1gPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EsTVg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTWA8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV",
  "base64",
);

/** A fetch that records what it is asked to send and answers with silence. */
export function recordingFetch(into: RelayedRequest[]): typeof fetch {
  return (async (input: RequestInfo | URL, init: Init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init.method ?? "GET").toUpperCase();
    const request = {
      method,
      url,
      headers: plainHeaders(init.headers),
      body: bodyBytes(init.body).toString("base64"),
    };
    into.push({ id: fingerprint(request), provider: providerOf(url), ...request });
    // ElevenLabs' with-timestamps endpoints answer the audio inside JSON (lib/generation/tts.ts).
    if (new URL(url).pathname.endsWith("/with-timestamps")) {
      return new Response(JSON.stringify({ audio_base64: SILENCE.toString("base64"), alignment: null }), {
        status: 200,
        headers: { "content-type": "application/json", "character-cost": "0" },
      });
    }
    return new Response(new Uint8Array(SILENCE), {
      status: 200,
      headers: { "content-type": "audio/mpeg", "character-cost": "0" },
    });
  }) as typeof fetch;
}

/** Thrown when an answered run sends a request the claim never recorded. */
export class RelayMismatch extends Error {
  constructor() {
    super("the line changed while it was being generated");
  }
}

/**
 * A fetch that answers each request from what the Manager sent back. `seen.mismatch` is set
 * when a request has no answer, so the caller can tell a changed line from a failed one: both
 * reach it as the provider not being reachable.
 */
export function answeringFetch(answers: RelayedAnswer[], seen: { mismatch: boolean }): typeof fetch {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  return (async (input: RequestInfo | URL, init: Init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const id = fingerprint({
      method: (init.method ?? "GET").toUpperCase(),
      url,
      headers: plainHeaders(init.headers),
      body: bodyBytes(init.body).toString("base64"),
    });
    const answer = byId.get(id);
    if (!answer) {
      seen.mismatch = true;
      throw new RelayMismatch();
    }
    if ("error" in answer) throw new Error(answer.error);
    const headers: Record<string, string> = {};
    if (answer.contentType) headers["content-type"] = answer.contentType;
    if (answer.characterCost) headers["character-cost"] = answer.characterCost;
    return new Response(new Uint8Array(Buffer.from(answer.body, "base64")), { status: answer.status, headers });
  }) as typeof fetch;
}

/** Thrown by the recording run's commit, which is where a recording run is over. */
export class Recorded extends Error {
  constructor() {
    super("recorded");
  }
}

export async function stopBeforeCommit(): Promise<never> {
  throw new Recorded();
}

/**
 * The ElevenLabs voices a Manager's account holds, as listVoices reads them
 * (lib/voices/elevenlabs.ts): clones named for a slot, by the clone's name.
 */
export async function rosterFrom(voices: { name: string; voiceId: string }[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const voice of voices) {
    const clone = parseCloneName(voice.name);
    if (clone && (await isVoiceSlot(clone.voice))) found.set(voice.name, voice.voiceId);
  }
  return found;
}

/** A roster's voices for one language, by slot, as generationStatus picks them out. */
export function voicesIn(roster: ReadonlyMap<string, string>, lang: Lang): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [name, id] of roster) {
    const clone = parseCloneName(name);
    if (clone && clone.lang === lang) ids.set(clone.voice, id);
  }
  return ids;
}

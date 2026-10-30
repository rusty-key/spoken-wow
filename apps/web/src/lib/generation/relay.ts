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

import { KEY_HEADERS, type RelayedAnswer, type RelayedRequest } from "@/lib/worker/protocol";

import { fishAudioAnswer } from "./fish-tts";
import type { Provider } from "./providers";
import { timedAudioAnswer } from "./tts";

type Init = { method?: string; headers?: HeadersInit; body?: BodyInit | null };

/** A request as fetch was asked to send it, without its key. */
type Sent = Omit<RelayedRequest, "id" | "body"> & { body: Buffer };

function bodyBytes(body: BodyInit | null | undefined): Buffer {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  throw new Error("a relayed request's body must be text or bytes");
}

function sent(input: RequestInfo | URL, init: Init): Sent {
  const headers: Record<string, string> = {};
  for (const [name, value] of new Headers(init.headers).entries()) {
    if (!KEY_HEADERS.has(name)) headers[name] = value;
  }
  return {
    method: (init.method ?? "GET").toUpperCase(),
    url: String(input instanceof Request ? input.url : input),
    headers,
    body: bodyBytes(init.body),
  };
}

/** Everything in a request but the key: what decides whether an answer is its answer. */
function fingerprint(request: Sent): string {
  const headers = Object.entries(request.headers).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify([request.method, request.url, headers]))
    .update("\0")
    .update(request.body)
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

/** Each provider's answer for some audio, in the shape its module reads it. */
const ANSWER: Record<Provider, (audio: Buffer) => Response> = {
  elevenlabs: timedAudioAnswer,
  fish: fishAudioAnswer,
};

/** A fetch that records what it is asked to send and answers with silence, as `provider` would. */
export function recordingFetch(into: RelayedRequest[], provider: Provider): typeof fetch {
  return (async (input: RequestInfo | URL, init: Init = {}) => {
    const request = sent(input, init);
    into.push({ id: fingerprint(request), ...request, body: request.body.toString("base64") });
    return ANSWER[provider](SILENCE);
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
    const answer = byId.get(fingerprint(sent(input, init)));
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

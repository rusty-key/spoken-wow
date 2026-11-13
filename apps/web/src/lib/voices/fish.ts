/**
 * Talking to fish.audio about the account and about clips: the balance, and transcripts.
 *
 * Speech itself is ../generation/fish-tts.ts, as ElevenLabs speech is ../generation/tts.ts
 * and its account is ./elevenlabs.ts.
 *
 * `fetch` and the base URL are both injectable: no test should need a fish.audio account,
 * and none should ever spend money.
 */
import { encode } from "@msgpack/msgpack";

import { fishMessage } from "@/lib/generation/errors";

import type { Fetch } from "./elevenlabs";

export const DEFAULT_FISH_URL = "https://api.fish.audio";

export type FishOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: Fetch;
};

export function fishConfig(options: FishOptions = {}) {
  // No fallback to a server-wide key, for ElevenLabs' reason: every request is spent from
  // the signed-in user's own account, and a route reaching here with nothing skipped the
  // guard that says whose.
  const { apiKey } = options;
  if (!apiKey) throw new Error("no fish.audio key was supplied for this request");
  return {
    apiKey,
    baseUrl: options.baseUrl ?? process.env.FISH_BASE_URL ?? DEFAULT_FISH_URL,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  };
}

/**
 * The models a collaborator may pick, and what each costs.
 *
 * Listed here rather than read from the account because fish.audio has no endpoint that
 * lists TTS models with their prices. The price is list price per million UTF-8 bytes of
 * text (docs.fish.audio, "Pricing & Rate Limits"); null is a model fish.audio has not priced,
 * which estimates as unknown rather than as a guess.
 */
export const FISH_MODELS = [
  { id: "s2.1-pro", label: "S2.1 Pro", usdPerMillionBytes: 15, preview: false },
  // "For development and testing", with no latency guarantee. The same model as s2.1-pro.
  { id: "s2.1-pro-free", label: "S2.1 Pro (free)", usdPerMillionBytes: 0, preview: false },
  { id: "s2-pro", label: "S2 Pro", usdPerMillionBytes: 15, preview: false },
  // In the TTS request schema's list of models, but on no pricing page.
  { id: "drama-3", label: "Drama 3", usdPerMillionBytes: null, preview: false },
] as const;

/**
 * Ids fish.audio no longer accepts, by what replaced them. A stored setting naming one is read as
 * its replacement: sent as it is, fish.audio would quietly speak it with s2.1-pro and bill for it.
 */
export const RENAMED_FISH_MODELS: Readonly<Record<string, FishModelId>> = {
  "drama-3-preview": "drama-3",
};

export type FishModelId = (typeof FISH_MODELS)[number]["id"];

export const DEFAULT_FISH_MODEL: FishModelId = "s2.1-pro-free";

export function isFishModel(value: unknown): value is FishModelId {
  return FISH_MODELS.some((model) => model.id === value);
}

/** List price in dollars per million UTF-8 bytes, or null for a model with no known price. */
export function fishPrice(model: string): number | null {
  return FISH_MODELS.find((entry) => entry.id === model)?.usdPerMillionBytes ?? null;
}

/** Dollars for `bytes` of text on `model`, or null when the model has no known price. */
export function fishCost(model: string, bytes: number): number | null {
  const price = fishPrice(model);
  return price === null ? null : (bytes * price) / 1_000_000;
}

async function failure(response: Response, what: string): Promise<Error> {
  const raw = await response.text().catch(() => "");
  return new Error(`${what} failed (${response.status}): ${fishMessage(raw).slice(0, 300)}`);
}

export type Wallet = {
  /** Dollars left to spend. */
  credit: number;
  /** Dollars ever paid in, which is what fish.audio's concurrency tiers are keyed on. */
  cumulativeTopUp: number;
};

/**
 * The balance, and the one call that proves a key works without spending anything.
 *
 * `self` is fish.audio's own alias for the key's account, so no user id has to be learned
 * and stored first.
 */
export async function getWallet(options: FishOptions = {}): Promise<Wallet> {
  const { apiKey, baseUrl, fetchImpl } = fishConfig(options);

  const response = await fetchImpl(`${baseUrl}/wallet/self/api-credit`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, "reading the fish.audio balance");

  // Both are strings in the schema -- decimals, sent as text so they survive JSON exactly.
  const body = (await response.json()) as { credit?: unknown; cumulative_top_up?: unknown };
  const amount = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return { credit: amount(body.credit), cumulativeTopUp: amount(body.cumulative_top_up) };
}

/**
 * How many requests fish.audio lets this account have in flight.
 *
 * Its limits count concurrent requests, tiered by how much has ever been paid in, and a
 * tier unlocks the moment the top-up lands (docs.fish.audio, "Pricing & Rate Limits").
 */
export function fishConcurrency(cumulativeTopUp: number): number {
  if (cumulativeTopUp >= 1000) return 50;
  if (cumulativeTopUp >= 100) return 15;
  return 5;
}

/**
 * What is said in a clip, for a reference's transcript.
 *
 * `language` is ISO 639-1 and only a hint: fish.audio detects the language regardless. Sent
 * as msgpack rather than a multipart form because the audio is already a Buffer, and msgpack
 * carries it as bytes with no encoding step.
 */
export async function transcribe(
  audio: Buffer,
  language: string | null,
  options: FishOptions = {},
): Promise<string> {
  const { apiKey, baseUrl, fetchImpl } = fishConfig(options);

  const response = await fetchImpl(`${baseUrl}/v1/asr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/msgpack" },
    body: encode({ audio, language, ignore_timestamps: true }),
  });
  if (!response.ok) throw await failure(response, "transcribing the clip on fish.audio");

  const body = (await response.json()) as { text?: unknown };
  if (typeof body.text !== "string") throw new Error("fish.audio returned no transcript");
  return body.text.trim();
}

/**
 * Gemini, which listens to a race-gender's game clips side by side on /voices/design.
 *
 * Reached over REST with the caller's own key, like ElevenLabs. `fetchImpl` is injectable so no
 * test spends anything.
 */
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiOptions = { fetchImpl?: typeof globalThis.fetch; baseUrl?: string };

async function failure(response: Response, what: string): Promise<Error> {
  const body = await response.text().catch(() => "");
  return new Error(`${what} failed (${response.status}): ${body.slice(0, 300)}`);
}

/** Listing the models is free, so a key is checked before it is stored. Gemini has no plans. */
export async function verifyGeminiKey(key: string, options: GeminiOptions = {}): Promise<{ tier: null }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(`${options.baseUrl ?? GEMINI_BASE_URL}/models`, {
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw await failure(response, "checking the Gemini key");
  return { tier: null };
}

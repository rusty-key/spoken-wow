/**
 * Turning a provider's failure into something a batch can act on.
 *
 * The browser drives a batch one line at a time, so every failure needs an answer to one
 * question: keep going, or stop? Running out of credits means every remaining line will fail
 * the same way, and grinding through ninety more requests to discover that ninety more times
 * is the behaviour this exists to prevent. A single malformed line is the opposite.
 *
 * The upstream text is always carried through verbatim. It is the only thing that
 * distinguishes "your plan does not allow cloning" from "that sample was unusable", and
 * losing it behind a tidy message turns every failure into a support question.
 *
 * Nothing here throws. An error body arriving in a shape this does not recognise must not
 * become a 500 - that would replace a diagnosable upstream failure with an opaque local one.
 */

export type FailureKind =
  | "quota"
  | "auth"
  | "rate-limit"
  | "voice-missing"
  | "bad-request"
  | "upstream";

export type Failure = {
  kind: FailureKind;
  /** Safe to show a human, and includes the upstream text. */
  message: string;
  /** What our own route should answer with. */
  status: number;
  /** Whether a batch should stop rather than move to the next line. */
  fatal: boolean;
};

/** 402 is not one of ElevenLabs' statuses; it is ours, and the client keys "stop" off it. */
const STATUS: Record<FailureKind, number> = {
  quota: 402,
  auth: 502,
  "rate-limit": 429,
  "voice-missing": 409,
  "bad-request": 422,
  upstream: 502,
};

// A batch shares one voice and one key, so anything about the account or the voice will
// fail identically for every remaining line.
const FATAL: Record<FailureKind, boolean> = {
  quota: true,
  auth: true,
  "rate-limit": false,
  "voice-missing": true,
  "bad-request": false,
  upstream: false,
};

export function failure(kind: FailureKind, message: string): Failure {
  return { kind, message, status: STATUS[kind], fatal: FATAL[kind] };
}

/** Another request holds this file's lock. Not fatal: the batch moves on and retries. */
export function busy(file: string): Failure {
  return {
    ...failure("upstream", `${file} is already being regenerated; try again in a moment`),
    status: 409,
    fatal: false,
  };
}

/** Only busy() makes an upstream failure with status 409. */
export function isBusy(failure: Failure): boolean {
  return failure.kind === "upstream" && failure.status === 409;
}

/**
 * The `status` slug ElevenLabs puts inside `detail`, when it puts one there.
 *
 * `detail` is variously a string ("Unauthenticated"), an object with `status` and `message`,
 * or FastAPI's validation array. Only the object form carries a slug.
 */
function detailStatus(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const status = (detail as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

/** Whatever human-readable text the body carries, or the raw body if it carries none. */
function detailMessage(body: unknown, raw: string): string {
  if (!body || typeof body !== "object") return raw;
  const detail = (body as { detail?: unknown }).detail;

  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{ loc: [...], msg: "...", type: "..." }]
    const messages = detail
      .map((item) => (item && typeof item === "object" ? (item as { msg?: unknown }).msg : null))
      .filter((msg): msg is string => typeof msg === "string");
    if (messages.length) return messages.join("; ");
  }
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return raw;
}

/**
 * Slugs seen from ElevenLabs, mapped to what a batch should do about them.
 *
 * Matched before the HTTP status, because the statuses are not distinctive: running out of
 * credits and presenting a bad key are both 401, and only the slug tells them apart.
 */
const BY_SLUG: Record<string, FailureKind> = {
  quota_exceeded: "quota",
  invalid_api_key: "auth",
  missing_permissions: "auth",
  detected_unusual_activity: "auth",
  voice_not_found: "voice-missing",
  voice_limit_reached: "quota",
  too_many_concurrent_requests: "rate-limit",
  system_busy: "rate-limit",
};

/**
 * Classify a non-2xx response body from ElevenLabs.
 *
 * `raw` is the body text, already read. Passed in rather than read here so the caller keeps
 * control of the single read a Response body allows.
 */
export function classifyUpstream(httpStatus: number, raw: string, what: string): Failure {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON - a proxy error page, a gateway timeout. Falls through to the status below.
  }

  const slug = detailStatus(parsed);
  const text = detailMessage(parsed, raw).slice(0, 400) || `HTTP ${httpStatus}`;
  const say = (kind: FailureKind) => failure(kind, `${what}: ${text}`);

  if (slug && BY_SLUG[slug]) return say(BY_SLUG[slug]);

  if (httpStatus === 429) return say("rate-limit");
  if (httpStatus === 401 || httpStatus === 403) return say("auth");
  if (httpStatus === 404) return say("voice-missing");
  if (httpStatus === 422 || httpStatus === 400) return say("bad-request");

  return failure("upstream", `${what} failed (${httpStatus}): ${text}`);
}

/**
 * fish.audio's failures are JSON `{ status, message, reason }`. The message is the only clue
 * to what went wrong, so it is kept rather than replaced with the status line.
 */
export function fishMessage(raw: string): string {
  try {
    const body = JSON.parse(raw) as { message?: unknown; reason?: unknown };
    const parts = [body.message, body.reason].filter(
      (part): part is string => typeof part === "string" && part !== "",
    );
    if (parts.length) return parts.join(": ");
  } catch {
    // Not JSON - a proxy page. The raw text is all there is.
  }
  return raw;
}

/**
 * Classify a non-2xx response from fish.audio.
 *
 * Its bodies are `{ status, message, reason }` with no slug to key on, so the HTTP status is
 * the whole of the classification. 402 is fish.audio's empty balance, fatal to a batch for
 * the reason quota is; 503 is its "high load", which the next attempt may well get past.
 */
export function classifyFish(httpStatus: number, raw: string, what: string): Failure {
  const text = fishMessage(raw).slice(0, 400) || `HTTP ${httpStatus}`;
  const say = (kind: FailureKind) => failure(kind, `${what}: ${text}`);

  if (httpStatus === 402) return say("quota");
  if (httpStatus === 429 || httpStatus === 503) return say("rate-limit");
  if (httpStatus === 401 || httpStatus === 403) return say("auth");
  if (httpStatus === 422 || httpStatus === 400) return say("bad-request");

  return failure("upstream", `${what} failed (${httpStatus}): ${text}`);
}

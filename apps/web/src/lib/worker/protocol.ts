/**
 * Requests go only to the providers' speech endpoints, whatever the site says: the key is added
 * here, so any other host would receive it, and any other endpoint of theirs could hand the
 * account, or the key itself, back to the site.
 * No Node or server imports: the Manager bundles this file and the browser loads it.
 */
import { PROVIDER_NAME, PROVIDERS, SPEECH_PATH, type Provider } from "../generation/providers";

export type { Provider };

/** Where an author's lines for a provider are generated: on the site, or by their own worker. */
export type GenerationMode = "site" | "local";

type SpeechEndpoint = { provider: Provider; auth: (key: string) => Record<string, string>; paths: RegExp };

/** Matches exactly these paths, a voice id being letters, digits, `_` or `-`. */
function onlyPaths(...templates: string[]): RegExp {
  const escape = (text: string) => text.replace(/[.*+?^$()[\]{}|\\]/g, "\\$&");
  const alternatives = templates.map((template) => template.split("{voiceId}").map(escape).join("[A-Za-z0-9_-]+"));
  return new RegExp(`^(?:${alternatives.join("|")})$`);
}

/** The providers' API hosts, how each is given the key, and the only paths a worker sends there. */
const PROVIDER_HOSTS: ReadonlyMap<string, SpeechEndpoint> = new Map<string, SpeechEndpoint>([
  [
    "api.elevenlabs.io",
    {
      provider: "elevenlabs",
      auth: (key) => ({ "xi-api-key": key }),
      paths: onlyPaths(SPEECH_PATH.elevenlabsSpeech, SPEECH_PATH.elevenlabsDialogue),
    },
  ],
  [
    "api.fish.audio",
    { provider: "fish", auth: (key) => ({ authorization: `Bearer ${key}` }), paths: onlyPaths(SPEECH_PATH.fish) },
  ],
]);

/** The request headers that carry a key, lowercased: the site never records them, and a worker never sends the site's. */
export const KEY_HEADERS: ReadonlySet<string> = new Set(
  [...PROVIDER_HOSTS.values()].flatMap((host) => Object.keys(host.auth("")).map((name) => name.toLowerCase())),
);

/** One provider request for a worker to send, with the key it adds itself. */
export type RelayedRequest = {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Base64. */
  body: string;
};

/**
 * What the provider answered, or why it was not. `refused` is this worker declining to send
 * it, which no retry changes, as opposed to the provider being out of reach.
 */
export type RelayedAnswer =
  | { id: string; status: number; contentType: string | null; characterCost: string | null; body: string }
  | { id: string; error: string; refused?: true };

export type ClaimedJob = {
  jobId: string;
  attempt: number;
  provider: Provider;
  lineId: string;
  npcName: string;
  preview: string;
  requests: RelayedRequest[];
};

export type Answered =
  | { status: "done"; version: number }
  | { status: "failed"; kind: string; message: string }
  | { status: "changed" }
  | { status: "gone" }
  /** Given back unanswered: the provider could not be reached from here. */
  | { status: "released"; message: string };

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The provider endpoint a request may be sent to, or null for anything a worker refuses: not a
 * POST, not plain https on the default port, credentials, a query or fragment, or any path but
 * a speech endpoint's.
 */
export function speechEndpoint(request: Pick<RelayedRequest, "method" | "url">): SpeechEndpoint | null {
  if (request.method !== "POST") return null;
  let u: URL;
  try {
    u = new URL(request.url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.port || u.username || u.password || u.search || u.hash) return null;
  const endpoint = PROVIDER_HOSTS.get(u.hostname);
  return endpoint?.paths.test(u.pathname) ? endpoint : null;
}

/** Sends one request with the key, and says what came back. Never throws. */
export async function sendRequest(
  request: RelayedRequest,
  keys: Partial<Record<Provider, string>>,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayedAnswer> {
  const endpoint = speechEndpoint(request);
  if (!endpoint) {
    return { id: request.id, error: `refused to send a ${request.method} request to ${request.url}`, refused: true };
  }
  const key = keys[endpoint.provider];
  if (!key) return { id: request.id, error: `no ${PROVIDER_NAME[endpoint.provider]} key here`, refused: true };
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    // The site never sends a key; one that came anyway is dropped rather than sent beside ours.
    const lower = name.toLowerCase();
    if (!KEY_HEADERS.has(lower) && lower !== "host" && lower !== "content-length") headers[name] = value;
  }
  try {
    const res = await fetchImpl(request.url, {
      method: request.method,
      headers: { ...headers, ...endpoint.auth(key) },
      body: fromBase64(request.body) as BodyInit,
      signal: AbortSignal.timeout(180_000),
    });
    return {
      id: request.id,
      status: res.status,
      contentType: res.headers.get("content-type"),
      characterCost: res.headers.get("character-cost"),
      body: toBase64(new Uint8Array(await res.arrayBuffer())),
    };
  } catch (err) {
    return { id: request.id, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The account's voices as the site names them: `{ name, voiceId }` for each. Throws on failure. */
export async function listElevenLabsVoices(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ name: string; voiceId: string }[]> {
  const res = await fetchImpl("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs answered ${res.status} listing the voices`);
  const body = (await res.json()) as { voices?: { name?: unknown; voice_id?: unknown }[] };
  return (body.voices ?? [])
    .filter((v): v is { name: string; voice_id: string } => typeof v.name === "string" && typeof v.voice_id === "string")
    .map((v) => ({ name: v.name, voiceId: v.voice_id }));
}

const VOICES_TTL_MS = 60_000;

/**
 * Cached per key for a minute rather than listed every round, so a new clone shows up within
 * the minute.
 */
export function cachedVoices(
  fetchImpl?: typeof fetch,
): (key: string | undefined) => Promise<{ name: string; voiceId: string }[] | null> {
  let cached: { key: string; at: number; value: { name: string; voiceId: string }[] } | null = null;
  return async (key) => {
    if (!key) return null;
    if (cached?.key === key && Date.now() - cached.at < VOICES_TTL_MS) return cached.value;
    const value = await listElevenLabsVoices(key, fetchImpl);
    cached = { key, at: Date.now(), value };
    return value;
  };
}

/** The keys a worker may spend: those of the providers its author generates with on their own machine. */
export function localKeys(
  keys: Partial<Record<Provider, string>>,
  modes: Record<Provider, GenerationMode>,
): Partial<Record<Provider, string>> {
  const usable: Partial<Record<Provider, string>> = {};
  for (const provider of PROVIDERS) if (modes[provider] === "local" && keys[provider]) usable[provider] = keys[provider];
  return usable;
}

// ---------------------------------------------------------------- the site

export type SiteOptions = {
  /** The site's origin; empty for the page's own, in a browser. */
  siteUrl: string;
  fetchImpl?: typeof fetch;
  /** The Manager's token. A browser tab has none and is signed in instead. */
  token?: string;
  /** Sent as the user agent where the runtime allows it (the Manager). */
  userAgent?: string;
};

export class NotPaired extends Error {
  constructor() {
    super("This Spoken Manager is not paired with an account, or was unpaired on the site.");
  }
}

async function site<T>(opts: SiteOptions, route: string, body?: unknown): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.siteUrl}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(opts.userAgent ? { "user-agent": opts.userAgent } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(150_000),
  });
  if (res.status === 401) throw new NotPaired();
  if (!res.ok) throw new Error(`The site answered ${res.status}.`);
  return (await res.json()) as T;
}

export type Pairing = { code: string; poll: string; expiresAt: string; verifyUrl: string };

export function startPairing(opts: SiteOptions, label: string): Promise<Pairing> {
  return site<Pairing>(opts, "/api/worker/pair", { label });
}

export function pollPairing(
  opts: SiteOptions,
  poll: string,
): Promise<{ status: "pending" } | { status: "expired" } | { status: "approved"; token: string }> {
  return site(opts, "/api/worker/pair/poll", { poll });
}

/** A token already revoked on the site counts as done. */
export async function unpair(opts: SiteOptions): Promise<void> {
  try {
    await site(opts, "/api/worker/unpair", {});
  } catch (err) {
    if (!(err instanceof NotPaired)) throw err;
  }
}

export function whoAmI(
  opts: SiteOptions,
): Promise<{ name: string | null; modes: Record<Provider, GenerationMode> }> {
  return site(opts, "/api/worker/me");
}

// ---------------------------------------------------------------- one round

export type RoundOptions = SiteOptions & {
  keys: Partial<Record<Provider, string>>;
  /** How many lines at once. */
  width: number;
  /** ElevenLabs' voices, listed once a minute rather than once a round. */
  voices: () => Promise<{ name: string; voiceId: string }[] | null>;
  /** Each line as it starts and as it settles. */
  onLine?: (event: { job: ClaimedJob; answered?: Answered }) => void;
  /** Told when a claim could not be held; the line goes on regardless. */
  onWarning?: (message: string, error: unknown) => void;
  /** How often a claim is held while its requests are in flight. */
  holdEveryMs?: number;
};

export type RoundResult = {
  /** Lines claimed this round; none means the queue has nothing for this worker now. */
  claimed: number;
  done: number;
  failed: number;
  /** Why a line was given back, when one was: the worker should wait before claiming again. */
  unreachable?: string;
};

/**
 * One claim and its lines. The providers asked for are those with a key here; the site hands
 * out only those its author set to "on my computer".
 */
export async function runRound(opts: RoundOptions): Promise<RoundResult> {
  const providers = (Object.keys(opts.keys) as Provider[]).filter((p) => opts.keys[p]);
  if (providers.length === 0) return { claimed: 0, done: 0, failed: 0 };
  const voices = providers.includes("elevenlabs") ? await opts.voices() : null;
  const { jobs } = await site<{ jobs: ClaimedJob[] }>(opts, "/api/worker/claim", { providers, max: opts.width, voices });
  const result: RoundResult = { claimed: jobs.length, done: 0, failed: 0 };
  await Promise.all(
    jobs.map(async (job) => {
      opts.onLine?.({ job });
      const answered = await runJob(opts, job);
      if (answered.status === "done") result.done++;
      else if (answered.status === "failed") result.failed++;
      else if (answered.status === "released") result.unreachable = answered.message;
      opts.onLine?.({ job, answered });
    }),
  );
  return result;
}

/**
 * One line: its requests in turn, holding the claim meanwhile, then the answer. The first that
 * fails ends the line, so no later part is paid for only to be thrown away.
 */
async function runJob(opts: RoundOptions, job: ClaimedJob): Promise<Answered> {
  let dropped = false;
  const hold = setInterval(() => {
    site<{ held: boolean }>(opts, "/api/worker/hold", { jobId: job.jobId, attempt: job.attempt })
      .then((r) => {
        if (!r.held) dropped = true;
      })
      .catch((err: unknown) => opts.onWarning?.("could not hold a line", err));
  }, opts.holdEveryMs ?? 60_000);
  try {
    // In turn, not at once: a long fish.audio line is several requests, and the account's
    // concurrency is what `width` already spends.
    const answers: RelayedAnswer[] = [];
    for (const request of job.requests) {
      if (dropped) return { status: "gone" };
      const answer = await sendRequest(request, opts.keys, opts.fetchImpl);
      answers.push(answer);
      if ("error" in answer || answer.status < 200 || answer.status >= 300) break;
    }
    if (dropped) return { status: "gone" };
    // A request that got no answer at all never reached the provider, so nothing was spent:
    // the line goes back to the queue. A refusal is answered instead, and fails the line,
    // since it would be refused again on every claim.
    const last = answers.at(-1);
    if (last && "error" in last && !last.refused) {
      await site(opts, "/api/worker/release", { jobId: job.jobId, attempt: job.attempt });
      return { status: "released", message: last.error };
    }
    return await site<Answered>(opts, "/api/worker/answer", { jobId: job.jobId, attempt: job.attempt, answers });
  } finally {
    clearInterval(hold);
  }
}

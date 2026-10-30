/**
 * A remote worker's side of generating: what the Spoken Manager and a browser tab on
 * /generate both run. The site's side is lib/generation/relay.ts and lib/worker/jobs.ts.
 *
 * The site works out everything a line sends and hands over the requests without a key. The
 * worker sends each one to ElevenLabs or fish.audio with the author's key, which never leaves
 * their machine, and answers with what came back.
 *
 * A request goes only to the two providers' own hosts, whatever the site says: the key is
 * added here, so a request to anywhere else would hand the key to whoever named it.
 *
 * Plain fetch and Uint8Array, no Node and no server imports: the Manager bundles this file
 * (manager/electron.vite.config.ts, `@site-worker`) and the browser loads it. Its one import,
 * providers.ts, imports nothing.
 */
import { PROVIDER_NAME, PROVIDERS, type Provider } from "../generation/providers";

export type { Provider };

/** Where an author's lines for a provider are generated: on the site, or by their own worker. */
export type GenerationMode = "site" | "local";

/** The providers' API hosts, and how each is given the key. */
const PROVIDER_HOSTS: Record<string, { provider: Provider; auth: (key: string) => Record<string, string> }> = {
  "api.elevenlabs.io": { provider: "elevenlabs", auth: (key) => ({ "xi-api-key": key }) },
  "api.fish.audio": { provider: "fish", auth: (key) => ({ authorization: `Bearer ${key}` }) },
};

/** The request headers that carry a key, lowercased: the site never records them, and a worker never sends the site's. */
export const KEY_HEADERS: ReadonlySet<string> = new Set(
  Object.values(PROVIDER_HOSTS).flatMap((host) => Object.keys(host.auth("")).map((name) => name.toLowerCase())),
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

/** What the provider answered, or why it could not be reached. */
export type RelayedAnswer =
  | { id: string; status: number; contentType: string | null; characterCost: string | null; body: string }
  | { id: string; error: string };

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

/** The provider a request is for, from its URL alone, or null for a URL that is not one of theirs. */
export function providerOf(url: string): Provider | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  return PROVIDER_HOSTS[u.hostname]?.provider ?? null;
}

/** Sends one request with the key, and says what came back. Never throws. */
export async function sendRequest(
  request: RelayedRequest,
  keys: Partial<Record<Provider, string>>,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayedAnswer> {
  const provider = providerOf(request.url);
  if (!provider) return { id: request.id, error: `refused to send a request to ${request.url}` };
  const key = keys[provider];
  if (!key) return { id: request.id, error: `no ${PROVIDER_NAME[provider]} key here` };
  if (request.method !== "POST" && request.method !== "GET") {
    return { id: request.id, error: `refused a ${request.method} request` };
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    // The site never sends a key; one that came anyway is dropped rather than sent beside ours.
    const lower = name.toLowerCase();
    if (!KEY_HEADERS.has(lower) && lower !== "host" && lower !== "content-length") headers[name] = value;
  }
  try {
    const res = await fetchImpl(request.url, {
      method: request.method,
      headers: { ...headers, ...PROVIDER_HOSTS[new URL(request.url).hostname]!.auth(key) },
      ...(request.method === "POST" ? { body: fromBase64(request.body) as BodyInit } : {}),
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
 * listElevenLabsVoices, listed again at most once a minute per key rather than once a round:
 * a clone made since shows up within the minute.
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

/** One line: its requests in turn, holding the claim meanwhile, then the answer. */
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
      answers.push(await sendRequest(request, opts.keys, opts.fetchImpl));
    }
    if (dropped) return { status: "gone" };
    // A request that got no answer at all never reached the provider, so nothing was spent:
    // the line goes back to the queue rather than failing as though the provider refused it.
    const unreachable = answers.find((answer): answer is { id: string; error: string } => "error" in answer);
    if (unreachable) {
      await site(opts, "/api/worker/release", { jobId: job.jobId, attempt: job.attempt });
      return { status: "released", message: unreachable.error };
    }
    return await site<Answered>(opts, "/api/worker/answer", { jobId: job.jobId, attempt: job.attempt, answers });
  } finally {
    clearInterval(hold);
  }
}

// Generating: the author's queued lines, voiced on this machine with their own key.
//
// The site does everything but the provider call (apps/web/src/lib/generation/relay.ts): it
// works out what each line sends, and hands this the requests without a key. This sends each
// one to ElevenLabs or fish.audio with the author's key, which never leaves the machine, and
// answers the site with what came back; the site trims, stitches, measures and keeps the take.
//
// A request goes only to the two providers' own hosts, whatever the site says: the key is
// added here, so a request to anywhere else would hand the key to whoever named it.
//
// No electron imports, so it can be tested the way share.ts is.
import { log } from './state'

export const SITE_URL = 'https://spoken.rusty.one'

export type GenerateProvider = 'elevenlabs' | 'fish'

/** The providers' API hosts, and how each is given the key. */
const PROVIDER_HOSTS: Record<string, { provider: GenerateProvider; auth: (key: string) => Record<string, string> }> = {
  'api.elevenlabs.io': { provider: 'elevenlabs', auth: (key) => ({ 'xi-api-key': key }) },
  'api.fish.audio': { provider: 'fish', auth: (key) => ({ authorization: `Bearer ${key}` }) }
}

export interface RelayedRequest {
  id: string
  method: string
  url: string
  headers: Record<string, string>
  /** Base64. */
  body: string
}

export type RelayedAnswer =
  | { id: string; status: number; contentType: string | null; characterCost: string | null; body: string }
  | { id: string; error: string }

export interface ClaimedJob {
  jobId: string
  attempt: number
  provider: GenerateProvider
  lineId: string
  npcName: string
  preview: string
  requests: RelayedRequest[]
}

export type Answered =
  | { status: 'done'; version: number }
  | { status: 'failed'; kind: string; message: string }
  | { status: 'changed' }
  | { status: 'gone' }

/** The provider a request is for, from its URL alone, or null for a URL that is not one of theirs. */
export function providerOf(url: string): GenerateProvider | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null
  return PROVIDER_HOSTS[u.hostname]?.provider ?? null
}

/** Sends one request with the key, and says what came back. Never throws. */
export async function sendRequest(
  request: RelayedRequest,
  keys: Partial<Record<GenerateProvider, string>>,
  fetchImpl: typeof fetch = fetch
): Promise<RelayedAnswer> {
  const provider = providerOf(request.url)
  if (!provider) return { id: request.id, error: `refused to send a request to ${request.url}` }
  const key = keys[provider]
  if (!key) return { id: request.id, error: `no ${provider === 'fish' ? 'fish.audio' : 'ElevenLabs'} key on this computer` }
  if (request.method !== 'POST' && request.method !== 'GET') return { id: request.id, error: `refused a ${request.method} request` }
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers)) {
    // The site never sends a key; one that came anyway is dropped rather than sent beside ours.
    if (!['xi-api-key', 'authorization', 'host', 'content-length'].includes(name.toLowerCase())) headers[name] = value
  }
  try {
    const res = await fetchImpl(request.url, {
      method: request.method,
      headers: { ...headers, ...PROVIDER_HOSTS[new URL(request.url).hostname]!.auth(key) },
      ...(request.method === 'POST' ? { body: Buffer.from(request.body, 'base64') } : {}),
      signal: AbortSignal.timeout(180_000)
    })
    const body = Buffer.from(await res.arrayBuffer()).toString('base64')
    return {
      id: request.id,
      status: res.status,
      contentType: res.headers.get('content-type'),
      characterCost: res.headers.get('character-cost'),
      body
    }
  } catch (err) {
    return { id: request.id, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The account's voices as the site names them: `{ name, voiceId }` for each. Throws on failure. */
export async function listElevenLabsVoices(key: string, fetchImpl: typeof fetch = fetch): Promise<{ name: string; voiceId: string }[]> {
  const res = await fetchImpl('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`ElevenLabs answered ${res.status} listing the voices`)
  const body = (await res.json()) as { voices?: { name?: unknown; voice_id?: unknown }[] }
  return (body.voices ?? [])
    .filter((v): v is { name: string; voice_id: string } => typeof v.name === 'string' && typeof v.voice_id === 'string')
    .map((v) => ({ name: v.name, voiceId: v.voice_id }))
}

// ---------------------------------------------------------------- the site

export interface SiteOptions {
  siteUrl?: string
  fetchImpl?: typeof fetch
  appVersion: string
}

async function site<T>(opts: SiteOptions, route: string, init: { token?: string; body?: unknown; method?: string }): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch
  const res = await doFetch(`${opts.siteUrl ?? SITE_URL}${route}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'user-agent': `SpokenManager/${opts.appVersion}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {})
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(150_000)
  })
  if (res.status === 401) throw new NotPaired()
  if (!res.ok) throw new Error(`The site answered ${res.status}.`)
  return (await res.json()) as T
}

export class NotPaired extends Error {
  constructor() {
    super('This Spoken Manager is not paired with an account, or was unpaired on the site.')
  }
}

export interface Pairing {
  code: string
  poll: string
  expiresAt: string
  verifyUrl: string
}

export function startPairing(opts: SiteOptions, label: string): Promise<Pairing> {
  return site<Pairing>(opts, '/api/worker/pair', { body: { label } })
}

export function pollPairing(
  opts: SiteOptions,
  poll: string
): Promise<{ status: 'pending' } | { status: 'expired' } | { status: 'approved'; token: string }> {
  return site(opts, '/api/worker/pair/poll', { body: { poll } })
}

export function whoAmI(opts: SiteOptions, token: string): Promise<{ name: string | null; modes: Record<GenerateProvider, 'site' | 'local'> }> {
  return site(opts, '/api/worker/me', { token })
}

// ---------------------------------------------------------------- one round

export interface RoundOptions extends SiteOptions {
  token: string
  keys: Partial<Record<GenerateProvider, string>>
  /** How many lines at once. */
  width: number
  /** ElevenLabs' voices, listed once a minute rather than once a round. */
  voices: () => Promise<{ name: string; voiceId: string }[] | null>
  /** Each line as it starts and as it settles. */
  onLine?: (event: { job: ClaimedJob; answered?: Answered }) => void
  /** How often a claim is held while its requests are in flight. */
  holdEveryMs?: number
}

export interface RoundResult {
  /** Lines claimed this round; none means the queue has nothing for this machine now. */
  claimed: number
  done: number
  failed: number
}

/**
 * One claim and its lines. The providers asked for are those with a key here; the site hands
 * out only those its author set to "on my computer".
 */
export async function runRound(opts: RoundOptions): Promise<RoundResult> {
  const providers = (Object.keys(opts.keys) as GenerateProvider[]).filter((p) => opts.keys[p])
  if (providers.length === 0) return { claimed: 0, done: 0, failed: 0 }
  const voices = providers.includes('elevenlabs') ? await opts.voices() : null
  const { jobs } = await site<{ jobs: ClaimedJob[] }>(opts, '/api/worker/claim', {
    token: opts.token,
    body: { providers, max: opts.width, voices }
  })
  const result: RoundResult = { claimed: jobs.length, done: 0, failed: 0 }
  await Promise.all(
    jobs.map(async (job) => {
      opts.onLine?.({ job })
      const answered = await runJob(opts, job)
      if (answered.status === 'done') result.done++
      else if (answered.status === 'failed') result.failed++
      opts.onLine?.({ job, answered })
    })
  )
  return result
}

/** One line: its requests in turn, holding the claim meanwhile, then the answer. */
async function runJob(opts: RoundOptions, job: ClaimedJob): Promise<Answered> {
  let dropped = false
  const hold = setInterval(() => {
    site<{ held: boolean }>(opts, '/api/worker/hold', { token: opts.token, body: { jobId: job.jobId, attempt: job.attempt } })
      .then((r) => {
        if (!r.held) dropped = true
      })
      .catch((err) => log('Generating: could not hold a line:', err))
  }, opts.holdEveryMs ?? 60_000)
  hold.unref?.()
  try {
    // In turn, not at once: a long fish.audio line is several requests, and the account's
    // concurrency is what `width` already spends.
    const answers: RelayedAnswer[] = []
    for (const request of job.requests) {
      if (dropped) return { status: 'gone' }
      answers.push(await sendRequest(request, opts.keys, opts.fetchImpl))
    }
    if (dropped) return { status: 'gone' }
    return await site<Answered>(opts, '/api/worker/answer', {
      token: opts.token,
      body: { jobId: job.jobId, attempt: job.attempt, answers }
    })
  } finally {
    clearInterval(hold)
  }
}

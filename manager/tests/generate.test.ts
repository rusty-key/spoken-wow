import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GenerateStatus } from '../src/shared/types'
import { runRound, sendRequest, speechEndpoint, type ClaimedJob } from '../src/main/generate'
import { Generating } from '../src/main/generating'
import { tmpDir } from './helpers'

const request = (url: string, headers: Record<string, string> = {}, method = 'POST') => ({
  id: 'r1',
  method,
  url,
  headers: { 'content-type': 'application/json', ...headers },
  body: Buffer.from('{"text":"Well met."}').toString('base64')
})

const cipher = { encrypt: (t: string) => `sealed:${Buffer.from(t).toString('base64')}`, decrypt: (s: string) => Buffer.from(s.slice(7), 'base64').toString() }

describe('which requests go out', () => {
  it('knows the two providers by their hosts and nothing else', () => {
    expect(speechEndpoint(request('https://api.elevenlabs.io/v1/text-to-speech/x/with-timestamps'))?.provider).toBe('elevenlabs')
    expect(speechEndpoint(request('https://api.fish.audio:443/v1/tts'))?.provider).toBe('fish')
    for (const bad of ['http://api.fish.audio/v1/tts', 'https://api.fish.audio.evil.com/v1/tts', 'https://user@api.fish.audio/v1/tts', 'https://api.fish.audio:8443/v1/tts', 'https://evil.com/api.fish.audio/v1/tts', 'https://__proto__/v1/tts', 'not a url']) {
      expect(speechEndpoint(request(bad))).toBeNull()
    }
  })

  it('adds the key itself, drops any the site sent, and refuses every other host', async () => {
    const sent: { url: string; headers: Record<string, string> }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sent.push({ url, headers: init?.headers as Record<string, string> })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg', 'character-cost': '9' } })
    }) as unknown as typeof fetch

    const answer = await sendRequest(request('https://api.elevenlabs.io/v1/text-to-speech/v/with-timestamps', { 'xi-api-key': 'planted' }), { elevenlabs: 'mine' }, fetchImpl)
    expect(answer).toEqual({ id: 'r1', status: 200, contentType: 'audio/mpeg', characterCost: '9', body: Buffer.from([1, 2, 3]).toString('base64') })
    expect(sent[0]!.headers['xi-api-key']).toBe('mine')

    const fish = await sendRequest(request('https://api.fish.audio/v1/tts'), { fish: 'fishkey' }, fetchImpl)
    expect('status' in fish && fish.status).toBe(200)
    expect(sent[1]!.headers.authorization).toBe('Bearer fishkey')

    expect(await sendRequest(request('https://evil.example/steal'), { elevenlabs: 'mine', fish: 'fishkey' }, fetchImpl)).toMatchObject({ error: expect.stringMatching(/refused/), refused: true })
    expect(await sendRequest(request('https://api.fish.audio/v1/tts'), { elevenlabs: 'mine' }, fetchImpl)).toMatchObject({ error: expect.stringMatching(/no fish.audio key/), refused: true })
    expect(sent).toHaveLength(2)
  })

  it('sends only POSTs to the speech endpoints, so the site cannot read the account', async () => {
    const sent: string[] = []
    const fetchImpl = (async (url: string) => {
      sent.push(url)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const keys = { elevenlabs: 'mine', fish: 'fishkey' }
    for (const url of ['https://api.elevenlabs.io/v1/text-to-speech/v/with-timestamps', 'https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps', 'https://api.fish.audio/v1/tts']) {
      expect(await sendRequest(request(url), keys, fetchImpl)).toMatchObject({ status: 200 })
    }
    for (const [url, method] of [
      ['https://api.elevenlabs.io/v1/user', 'GET'],
      ['https://api.elevenlabs.io/v1/user', 'POST'],
      ['https://api.elevenlabs.io/v1/text-to-speech/v/with-timestamps', 'GET'],
      ['https://api.elevenlabs.io/v1/text-to-speech/v', 'POST'],
      ['https://api.elevenlabs.io/v1/text-to-speech/v/with-timestamps?output_format=pcm_44100', 'POST'],
      ['https://api.elevenlabs.io/v1/text-to-speech/../../v1/user/with-timestamps', 'POST'],
      ['https://api.elevenlabs.io/v1/text-to-speech/v%2F..%2F..%2Fuser/with-timestamps', 'POST'],
      ['https://api.elevenlabs.io/v1/voices/v', 'DELETE'],
      ['https://api.fish.audio/wallet/self/api-credit', 'GET'],
      ['https://api.fish.audio/v1/tts/extra', 'POST']
    ] as const) {
      expect(await sendRequest(request(url, {}, method), keys, fetchImpl)).toMatchObject({ refused: true })
    }
    expect(sent).toHaveLength(3)
  })
})

describe('a round', () => {
  it('claims, sends each request with the key, and answers the site', async () => {
    const job: ClaimedJob = {
      jobId: '7',
      attempt: 1,
      provider: 'fish',
      lineId: 'q:5:accept',
      npcName: 'Marshal Dughan',
      preview: 'Ah',
      requests: [request('https://api.fish.audio/v1/tts')]
    }
    const posted: { url: string; body: unknown; auth: string | undefined }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (url.startsWith('https://api.fish.audio')) return new Response(new Uint8Array([7]), { headers: { 'content-type': 'audio/mpeg' } })
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.authorization })
      if (url.endsWith('/api/worker/claim')) return Response.json({ jobs: [job] })
      if (url.endsWith('/api/worker/answer')) return Response.json({ status: 'done', version: 3 })
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

    const events: string[] = []
    const result = await runRound({
      siteUrl: 'https://site.test',
      fetchImpl,
      token: 'spw_token',
      keys: { fish: 'fishkey' },
      width: 2,
      voices: async () => null,
      onLine: ({ job: j, answered }) => events.push(`${j.lineId}:${answered?.status ?? 'start'}`)
    })

    expect(result).toEqual({ claimed: 1, done: 1, failed: 0 })
    expect(events).toEqual(['q:5:accept:start', 'q:5:accept:done'])
    expect(posted.map((p) => p.url)).toEqual(['https://site.test/api/worker/claim', 'https://site.test/api/worker/answer'])
    expect(posted.every((p) => p.auth === 'Bearer spw_token')).toBe(true)
    expect(posted[0]!.body).toEqual({ providers: ['fish'], max: 2, voices: null })
    const answer = posted[1]!.body as { jobId: string; attempt: number; answers: { id: string; status: number; body: string }[] }
    expect(answer).toMatchObject({ jobId: '7', attempt: 1 })
    expect(answer.answers[0]).toMatchObject({ id: 'r1', status: 200, body: Buffer.from([7]).toString('base64') })
    // The site never sees the key.
    expect(JSON.stringify(posted)).not.toContain('fishkey')
  })
})

describe('a line whose request fails', () => {
  const fish = (id: string) => ({ ...request('https://api.fish.audio/v1/tts'), id })
  const job: ClaimedJob = { jobId: '4', attempt: 1, provider: 'fish', lineId: 'q:4:accept', npcName: 'N', preview: 'P', requests: [fish('p1'), fish('p2'), fish('p3')] }

  async function round(provider: (n: number) => Response | Promise<Response>, claimed: ClaimedJob = job) {
    const posted: { url: string; body: { answers?: { id: string }[] } }[] = []
    let sent = 0
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://api.fish.audio')) return provider(++sent)
      posted.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
      if (url.endsWith('/api/worker/claim')) return Response.json({ jobs: [claimed] })
      if (url.endsWith('/api/worker/answer')) return Response.json({ status: 'failed', kind: 'upstream', message: 'no' })
      return Response.json({ released: true })
    }) as unknown as typeof fetch
    const result = await runRound({ siteUrl: 'https://site.test', fetchImpl, token: 't', keys: { fish: 'k' }, width: 1, voices: async () => null })
    return { result, sent, posted: posted.slice(1) }
  }

  it('sends no later part once one is refused by the provider, and answers with the refusal', async () => {
    const { result, sent, posted } = await round((n) => new Response(new Uint8Array([n]), { status: n === 2 ? 402 : 200 }))
    expect(sent).toBe(2)
    expect(result).toEqual({ claimed: 1, done: 0, failed: 1 })
    expect(posted.map((p) => p.url)).toEqual(['https://site.test/api/worker/answer'])
    expect(posted[0]!.body.answers!.map((a) => a.id)).toEqual(['p1', 'p2'])
  })

  it('sends no later part once one cannot reach the provider, and gives the line back', async () => {
    const { result, sent, posted } = await round((n) => {
      if (n === 1) throw new TypeError('Failed to fetch')
      return new Response(new Uint8Array([n]))
    })
    expect(sent).toBe(1)
    expect(result).toEqual({ claimed: 1, done: 0, failed: 0, unreachable: 'Failed to fetch' })
    expect(posted.map((p) => p.url)).toEqual(['https://site.test/api/worker/release'])
  })

  it('answers a request it refused to send, so the line fails instead of coming back forever', async () => {
    const refused: ClaimedJob = { ...job, requests: [{ ...request('https://api.fish.audio/v1/account'), id: 'x' }] }
    const { result, sent, posted } = await round(() => new Response(new Uint8Array([1])), refused)
    expect(sent).toBe(0)
    expect(result).toEqual({ claimed: 1, done: 0, failed: 1 })
    expect(posted.map((p) => p.url)).toEqual(['https://site.test/api/worker/answer'])
    expect(posted[0]!.body.answers).toEqual([expect.objectContaining({ id: 'x', refused: true })])
  })
})

describe('the secrets', () => {
  it('keeps keys encrypted on disk and tells the window only whether each is set', () => {
    const dataPath = tmpDir()
    const statuses: GenerateStatus[] = []
    const generating = new Generating({ dataPath, appVersion: '0', cipher, send: (s) => statuses.push(s), openExternal: () => undefined })
    generating.setKey('elevenlabs', ' sk_secret ')
    const onDisk = fs.readFileSync(path.join(dataPath, 'generate.json'), 'utf8')
    expect(onDisk).not.toContain('sk_secret')
    expect(statuses.at(-1)!.keys).toEqual({ elevenlabs: true, fish: false })
    expect(JSON.stringify(statuses)).not.toContain('sk_secret')

    const again = new Generating({ dataPath, appVersion: '0', cipher, send: () => undefined, openExternal: () => undefined })
    expect(again.status.keys).toEqual({ elevenlabs: true, fish: false })
    again.setKey('elevenlabs', '')
    expect(again.status.keys.elevenlabs).toBe(false)
  })
})

describe('unpairing', () => {
  function paired(fetchImpl: typeof fetch) {
    const dataPath = tmpDir()
    fs.writeFileSync(path.join(dataPath, 'generate.json'), JSON.stringify({ token: cipher.encrypt('spw_token'), keys: {} }))
    const statuses: GenerateStatus[] = []
    const generating = new Generating({ dataPath, appVersion: '0', siteUrl: 'https://site.test', fetchImpl, cipher, send: (s) => statuses.push(s), openExternal: () => undefined })
    return { generating, statuses, dataPath }
  }

  it('revokes the token on the site, and forgets it here', async () => {
    const posted: { url: string; auth: string | undefined }[] = []
    const { generating, dataPath } = paired((async (url: string, init?: RequestInit) => {
      posted.push({ url, auth: (init?.headers as Record<string, string>).authorization })
      return Response.json({ unpaired: true })
    }) as unknown as typeof fetch)
    await generating.unpair()
    expect(posted).toEqual([{ url: 'https://site.test/api/worker/unpair', auth: 'Bearer spw_token' }])
    expect(fs.readFileSync(path.join(dataPath, 'generate.json'), 'utf8')).not.toContain('spw_token')
    expect(generating.status.error).toBeUndefined()
  })

  it('forgets the token here even when the site cannot be reached, and says so', async () => {
    const { generating, dataPath } = paired((async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch)
    await generating.unpair()
    expect(fs.readFileSync(path.join(dataPath, 'generate.json'), 'utf8')).not.toContain('spw_token')
    expect(generating.status.pairedAs).toBeNull()
    expect(generating.status.error).toMatch(/could not be reached/)
  })
})

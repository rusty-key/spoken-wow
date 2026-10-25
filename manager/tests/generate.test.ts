import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GenerateStatus } from '../src/shared/types'
import { providerOf, runRound, sendRequest, type ClaimedJob } from '../src/main/generate'
import { Generating } from '../src/main/generating'
import { tmpDir } from './helpers'

const request = (url: string, headers: Record<string, string> = {}) => ({
  id: 'r1',
  method: 'POST',
  url,
  headers: { 'content-type': 'application/json', ...headers },
  body: Buffer.from('{"text":"Well met."}').toString('base64')
})

describe('which requests go out', () => {
  it('knows the two providers by their hosts and nothing else', () => {
    expect(providerOf('https://api.elevenlabs.io/v1/text-to-speech/x')).toBe('elevenlabs')
    expect(providerOf('https://api.fish.audio/v1/tts')).toBe('fish')
    for (const bad of ['http://api.elevenlabs.io/v1', 'https://api.elevenlabs.io.evil.com/', 'https://user@api.fish.audio/', 'https://api.fish.audio:8443/', 'https://evil.com/api.elevenlabs.io']) {
      expect(providerOf(bad)).toBeNull()
    }
  })

  it('adds the key itself, drops any the site sent, and refuses every other host', async () => {
    const sent: { url: string; headers: Record<string, string> }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sent.push({ url, headers: init?.headers as Record<string, string> })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg', 'character-cost': '9' } })
    }) as unknown as typeof fetch

    const answer = await sendRequest(request('https://api.elevenlabs.io/v1/text-to-speech/v', { 'xi-api-key': 'planted' }), { elevenlabs: 'mine' }, fetchImpl)
    expect(answer).toEqual({ id: 'r1', status: 200, contentType: 'audio/mpeg', characterCost: '9', body: Buffer.from([1, 2, 3]).toString('base64') })
    expect(sent[0]!.headers['xi-api-key']).toBe('mine')

    const fish = await sendRequest(request('https://api.fish.audio/v1/tts'), { fish: 'fishkey' }, fetchImpl)
    expect('status' in fish && fish.status).toBe(200)
    expect(sent[1]!.headers.authorization).toBe('Bearer fishkey')

    expect(await sendRequest(request('https://evil.example/steal'), { elevenlabs: 'mine', fish: 'fishkey' }, fetchImpl)).toMatchObject({ error: expect.stringMatching(/refused/) })
    expect(await sendRequest(request('https://api.fish.audio/v1/tts'), { elevenlabs: 'mine' }, fetchImpl)).toMatchObject({ error: expect.stringMatching(/no fish.audio key/) })
    expect(sent).toHaveLength(2)
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
      appVersion: '0.0.0',
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

describe('the secrets', () => {
  const cipher = { encrypt: (t: string) => `sealed:${Buffer.from(t).toString('base64')}`, decrypt: (s: string) => Buffer.from(s.slice(7), 'base64').toString() }

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

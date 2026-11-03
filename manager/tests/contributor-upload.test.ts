import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import yauzl from 'yauzl'
import { describe, expect, it } from 'vitest'
import {
  checkCfToken,
  checkGhRepo,
  resolveGameVersions,
  uploadCurseForge,
  uploadGitHub,
  zipFolder
} from '../src/main/contributor-upload'
import { PlainError } from '../src/main/errors'
import { tmpDir, write } from './helpers'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

type Answer = { status: number; body?: unknown; text?: string }

/** A fetch that records every call and answers from `route`, which sees the URL and method. */
function fake(route: (url: string, method: string) => Answer): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v))
    calls.push({ url, method, headers, body: init?.body })
    const a = route(url, method)
    const text = a.text ?? (a.body === undefined ? '' : JSON.stringify(a.body))
    return new Response(a.status === 204 ? null : text, { status: a.status })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function readZip(file: string): Promise<{ names: string[]; methods: number[] }> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zf) => {
      if (err) return reject(err)
      const names: string[] = []
      const methods: number[] = []
      zf.on('entry', (e) => {
        names.push(e.fileName)
        methods.push(e.compressionMethod)
        zf.readEntry()
      })
      zf.on('end', () => resolve({ names, methods }))
      zf.on('error', reject)
      zf.readEntry()
    })
  })
}

const signal = new AbortController().signal
const TOKEN = 'sekrit-token-123'

describe('zipFolder', () => {
  it('stores entries uncompressed under <folder>/ and leaves out .DS_Store', async () => {
    const addOns = tmpDir()
    write(path.join(addOns, 'Pack_x', 'Pack_x.toc'), '## Version: 1\n'.repeat(200))
    write(path.join(addOns, 'Pack_x', 'sub', 'a.ogg'), 'ogg')
    write(path.join(addOns, 'Pack_x', '.DS_Store'), 'junk')
    write(path.join(addOns, 'Pack_x', 'sub', '.DS_Store'), 'junk')
    const dest = path.join(tmpDir(), 'out.zip')
    await zipFolder(addOns, 'Pack_x', dest, signal)
    const { names, methods } = await readZip(dest)
    expect(names.sort()).toEqual(['Pack_x/Pack_x.toc', 'Pack_x/sub/a.ogg'])
    expect(methods.every((m) => m === 0)).toBe(true)
  })
})

describe('resolveGameVersions', () => {
  const list = [
    { id: 11, name: '1.15.9' },
    { id: 22, name: '2.5.6' },
    { id: 33, name: '1.60.1' },
    { id: 44, name: '9.9' },
    { id: 45, name: '9.9' }
  ]
  it('maps names to ids in order', async () => {
    const { fetchImpl, calls } = fake(() => ({ status: 200, body: list }))
    expect(await resolveGameVersions(TOKEN, '1.60.1 1.15.9', fetchImpl)).toEqual([33, 11])
    expect(calls[0]!.url).toBe('https://wow.curseforge.com/api/game/versions')
    expect(calls[0]!.headers['x-api-token']).toBe(TOKEN)
  })
  it('names the version on zero or two matches', async () => {
    const { fetchImpl } = fake(() => ({ status: 200, body: list }))
    await expect(resolveGameVersions(TOKEN, '7.7', fetchImpl)).rejects.toThrow(/7\.7/)
    await expect(resolveGameVersions(TOKEN, '9.9', fetchImpl)).rejects.toThrow(/9\.9/)
    await expect(resolveGameVersions(TOKEN, '7.7', fetchImpl)).rejects.toBeInstanceOf(PlainError)
  })
})

function zipFile(): string {
  const f = path.join(tmpDir(), 'Pack_x-1.2.3.zip')
  fs.writeFileSync(f, 'zipbytes')
  return f
}

const cfArgs = (fetchImpl: typeof fetch) => ({
  token: TOKEN,
  project: '1234',
  folder: 'Pack_x',
  version: '1.2.3',
  zip: zipFile(),
  notes: 'Notes "here"',
  gameVersionIds: [11, 22],
  signal,
  fetchImpl
})

/** A store that reads the whole body, the way a real one does. */
const draining = (answer: () => Response) =>
  (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) await new Response(init.body).arrayBuffer()
    return answer()
  }) as unknown as typeof fetch

describe('upload progress', () => {
  it('counts a CurseForge body up to its Content-Length', async () => {
    const seen: Array<[number, number]> = []
    let length = 0
    const inner = draining(() => new Response('{"id":1}'))
    const fetchImpl = ((url: RequestInfo | URL, init?: RequestInit) => {
      length = Number(new Headers(init?.headers).get('content-length'))
      return inner(url, init)
    }) as typeof fetch
    await uploadCurseForge({ ...cfArgs(fetchImpl), onProgress: (sent, total) => seen.push([sent, total]) })
    expect(seen[0]).toEqual([0, length])
    expect(seen.at(-1)).toEqual([length, length])
    expect(seen.map(([sent]) => sent)).toEqual([...seen.map(([sent]) => sent)].sort((a, b) => a - b))
  })

  it('counts a GitHub asset by the bytes of the zip', async () => {
    const seen: number[] = []
    const fetchImpl = draining(() => new Response(JSON.stringify({ id: 5, assets: [] }), { status: 200 }))
    await uploadGitHub({ token: TOKEN, repo: 'me/packs', folder: 'Pack_x', version: '1.2.3', zip: zipFile(), notes: 'n', signal, fetchImpl, onProgress: (sent) => seen.push(sent) })
    expect(seen).toEqual([0, 'zipbytes'.length])
  })

  it('reaches a real server whole through the real fetch, at the length it declared', async () => {
    const received: Array<{ length: string | undefined; bytes: number }> = []
    const server = http.createServer((req, res) => {
      let bytes = 0
      req.on('data', (c: Buffer) => (bytes += c.length))
      req.on('end', () => {
        received.push({ length: req.headers['content-length'], bytes })
        res.end(JSON.stringify({ id: 5, assets: [] }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    const local = ((url: RequestInfo | URL, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${new URL(String(url)).pathname}`, init)) as typeof fetch
    try {
      await uploadCurseForge(cfArgs(local))
      await uploadGitHub({ token: TOKEN, repo: 'me/packs', folder: 'Pack_x', version: '1.2.3', zip: zipFile(), notes: 'n', signal, fetchImpl: local })
    } finally {
      server.close()
    }
    expect(received.at(0)!.bytes).toBe(Number(received.at(0)!.length))
    expect(received.at(-1)).toEqual({ length: String('zipbytes'.length), bytes: 'zipbytes'.length })
  })
})

describe('uploadCurseForge', () => {
  it('sends the token and multipart metadata', async () => {
    const { fetchImpl, calls } = fake(() => ({ status: 200, body: { id: 987 } }))
    const r = await uploadCurseForge(cfArgs(fetchImpl))
    expect(r.fileId).toBe('987')
    expect(r.link).toContain('1234')
    const c = calls[0]!
    expect(c.url).toBe('https://wow.curseforge.com/api/projects/1234/upload-file')
    expect(c.method).toBe('POST')
    expect(c.headers['x-api-token']).toBe(TOKEN)
    expect(c.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(Number(c.headers['content-length'])).toBeGreaterThan(8)
  })
  it('resolves with fileId null when a 2xx body is not JSON', async () => {
    const { fetchImpl } = fake(() => ({ status: 200, text: 'ok, thanks' }))
    expect((await uploadCurseForge(cfArgs(fetchImpl))).fileId).toBeNull()
  })
  it("says a 413 is over CurseForge's upload limit", async () => {
    const { fetchImpl } = fake(() => ({ status: 413, text: 'big' }))
    await expect(uploadCurseForge(cfArgs(fetchImpl))).rejects.toThrow(/over CurseForge's upload limit/)
  })
})

const ghArgs = (fetchImpl: typeof fetch) => ({
  token: TOKEN,
  repo: 'me/repo',
  folder: 'Pack_x',
  version: '1.2.3',
  zip: zipFile(),
  notes: 'n',
  signal,
  fetchImpl
})

const release = (assets: string[], state = 'uploaded') => ({
  id: 55,
  upload_url: 'https://uploads.github.com/repos/me/repo/releases/55/assets{?name,label}',
  assets: assets.map((name, i) => ({ id: 700 + i, name, state }))
})

describe('uploadGitHub', () => {
  it('creates a release on a 404 tag and uploads the asset with Content-Length', async () => {
    const { fetchImpl, calls } = fake((url, method) => {
      if (method === 'GET') return { status: 404, body: { message: 'Not Found' } }
      if (url.endsWith('/releases')) return { status: 201, body: release([]) }
      return { status: 201, body: {} }
    })
    const r = await uploadGitHub(ghArgs(fetchImpl))
    expect(r).toEqual({ link: 'https://github.com/me/repo/releases/tag/Pack_x/v1.2.3', alreadyThere: false })
    expect(calls[0]!.url).toBe('https://api.github.com/repos/me/repo/releases/tags/Pack_x/v1.2.3')
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(String(calls[1]!.body))).toEqual({
      tag_name: 'Pack_x/v1.2.3',
      name: 'Pack_x 1.2.3',
      body: 'n'
    })
    const up = calls[2]!
    expect(up.url).toBe('https://uploads.github.com/repos/me/repo/releases/55/assets?name=Pack_x-1.2.3.zip')
    expect(up.headers['content-length']).toBe('8')
    expect(up.headers['content-type']).toBe('application/zip')
  })
  it('reuses a release that has no asset', async () => {
    const { fetchImpl, calls } = fake((_url, method) =>
      method === 'GET' ? { status: 200, body: release([]) } : { status: 201, body: {} }
    )
    const r = await uploadGitHub(ghArgs(fetchImpl))
    expect(r.alreadyThere).toBe(false)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST'])
    expect(calls[1]!.url).toContain('uploads.github.com')
  })
  it('sends no upload when the asset is already there', async () => {
    const { fetchImpl, calls } = fake(() => ({ status: 200, body: release(['Pack_x-1.2.3.zip']) }))
    const r = await uploadGitHub(ghArgs(fetchImpl))
    expect(r.alreadyThere).toBe(true)
    expect(calls).toHaveLength(1)
  })
  it('removes an asset of that name cut short, and only that one, then uploads', async () => {
    const asset = { id: 700, name: 'Pack_x-1.2.3.zip', state: 'starter' }
    const others = [
      { id: 701, name: 'Pack_x-1.2.2.zip', state: 'starter' },
      { id: 702, name: 'Other-1.2.3.zip', state: 'uploaded' }
    ]
    const { fetchImpl, calls } = fake((_url, method) => {
      if (method === 'GET') return { status: 200, body: { ...release([]), assets: [...others, asset] } }
      if (method === 'DELETE') return { status: 204 }
      return { status: 201, body: {} }
    })
    const r = await uploadGitHub(ghArgs(fetchImpl))
    expect(r.alreadyThere).toBe(false)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE', 'POST'])
    expect(calls[1]!.url).toBe('https://api.github.com/repos/me/repo/releases/assets/700')
    expect(calls[1]!.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[2]!.url).toContain('uploads.github.com')
  })
  it('a delete that fails is a PlainError without the token, and nothing is uploaded', async () => {
    const { fetchImpl, calls } = fake((_url, method) => {
      if (method === 'GET') return { status: 200, body: release(['Pack_x-1.2.3.zip'], 'starter') }
      return { status: 403, text: `refused ${TOKEN}` }
    })
    const err = await uploadGitHub(ghArgs(fetchImpl)).catch((e: Error) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect((err as Error).message).toMatch(/Could not remove/)
    expect((err as Error).message).not.toContain(TOKEN)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE'])
  })
  it('a partial asset with no id to delete it by is a PlainError', async () => {
    const { fetchImpl, calls } = fake(() => ({ status: 200, body: { ...release([]), assets: [{ name: 'Pack_x-1.2.3.zip', state: 'starter' }] } }))
    await expect(uploadGitHub(ghArgs(fetchImpl))).rejects.toBeInstanceOf(PlainError)
    expect(calls).toHaveLength(1)
  })
})

describe('checks', () => {
  it('checkCfToken accepts a good token and rejects a bad one', async () => {
    await checkCfToken(TOKEN, fake(() => ({ status: 200, body: [] })).fetchImpl)
    await expect(checkCfToken(TOKEN, fake(() => ({ status: 401, text: 'no' })).fetchImpl)).rejects.toBeInstanceOf(
      PlainError
    )
  })
  it('checkGhRepo refuses a repo whose permissions.push is false', async () => {
    const ok = fake(() => ({ status: 200, body: { permissions: { push: true } } }))
    await checkGhRepo(TOKEN, 'me/repo', ok.fetchImpl)
    expect(ok.calls[0]!.url).toBe('https://api.github.com/repos/me/repo')
    const no = fake(() => ({ status: 200, body: { permissions: { push: false } } }))
    await expect(checkGhRepo(TOKEN, 'me/repo', no.fetchImpl)).rejects.toThrow(/push|write/i)
  })
})

describe('secrets', () => {
  it('a rejection message never contains the token', async () => {
    const f = fake(() => ({ status: 401, text: `bad token ${TOKEN} for you` })).fetchImpl
    const messages: string[] = []
    const grab = async (p: Promise<unknown>): Promise<void> => {
      try {
        await p
        messages.push('RESOLVED')
      } catch (e) {
        expect(e).toBeInstanceOf(PlainError)
        messages.push((e as Error).message)
      }
    }
    await grab(resolveGameVersions(TOKEN, '1.15.9', f))
    await grab(checkCfToken(TOKEN, f))
    await grab(checkGhRepo(TOKEN, 'me/repo', f))
    await grab(uploadCurseForge(cfArgs(f)))
    await grab(uploadGitHub(ghArgs(f)))
    expect(messages).toHaveLength(5)
    for (const m of messages) {
      expect(m).not.toBe('RESOLVED')
      expect(m).not.toContain(TOKEN)
    }
  })
})

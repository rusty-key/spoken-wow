import fs from 'node:fs'
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
    return new Response(text, { status: a.status })
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
    const form = c.body as FormData
    expect(form.get('file')).toBeInstanceOf(Blob)
    const meta = JSON.parse(String(form.get('metadata')))
    expect(meta).toEqual({
      changelog: 'Notes "here"',
      changelogType: 'markdown',
      displayName: 'Pack_x 1.2.3',
      gameVersions: [11, 22],
      releaseType: 'release',
      relations: { projects: [{ slug: 'spoken', type: 'requiredDependency' }] }
    })
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

const release = (assets: string[]) => ({
  id: 55,
  upload_url: 'https://uploads.github.com/repos/me/repo/releases/55/assets{?name,label}',
  assets: assets.map((name) => ({ name }))
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

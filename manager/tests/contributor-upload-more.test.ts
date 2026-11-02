import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { uploadCurseForge, uploadGitHub, zipFolder } from '../src/main/contributor-upload'
import { PlainError } from '../src/main/errors'
import { tmpDir, write } from './helpers'

const signal = new AbortController().signal
const TOKEN = 'sekrit-token-123'

const cfArgs = (fetchImpl: typeof fetch, zip: string) => ({
  token: TOKEN,
  project: '1234',
  folder: 'Pack_x',
  version: '1.2.3',
  zip,
  notes: 'n',
  gameVersionIds: [11, 22],
  signal,
  fetchImpl
})

const ghArgs = (fetchImpl: typeof fetch, zip: string) => ({
  token: TOKEN,
  repo: 'me/repo',
  folder: 'Pack_x',
  version: '1.2.3',
  zip,
  notes: 'n',
  signal,
  fetchImpl
})

const release = (assets: unknown[]) => ({
  id: 55,
  upload_url: 'https://uploads.github.com/repos/me/repo/releases/55/assets{?name,label}',
  assets
})

function bigZip(): { file: string; bytes: Buffer } {
  const bytes = Buffer.alloc(300_000)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) & 255
  const file = path.join(tmpDir(), 'Pack_x-1.2.3.zip')
  fs.writeFileSync(file, bytes)
  return { file, bytes }
}

describe('zipFolder failures', () => {
  const addOns = (): string => {
    const dir = tmpDir()
    write(path.join(dir, 'Pack_x', 'a.ogg'), 'ogg')
    return dir
  }
  it('rejects with a PlainError for a missing folder, without the path', async () => {
    const dir = tmpDir()
    const err = await zipFolder(dir, 'Nope', path.join(dir, 'o.zip'), signal).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).not.toContain(dir)
  })
  it('rejects, leaves no partial zip and does not hang when a file vanishes after listing', async () => {
    const dir = addOns()
    const dest = path.join(tmpDir(), 'o.zip')
    const real = fs.promises.readdir
    const spy = vi.spyOn(fs.promises, 'readdir').mockImplementation((async (...args: unknown[]) => {
      const out = await (real as (...a: unknown[]) => Promise<unknown>)(...args)
      fs.rmSync(path.join(dir, 'Pack_x', 'a.ogg'))
      return out
    }) as never)
    try {
      await expect(zipFolder(dir, 'Pack_x', dest, signal)).rejects.toBeInstanceOf(PlainError)
    } finally {
      spy.mockRestore()
    }
    expect(fs.existsSync(dest)).toBe(false)
  })
  it('rejects with a PlainError when dest is a folder', async () => {
    const dir = addOns()
    await expect(zipFolder(dir, 'Pack_x', tmpDir(), signal)).rejects.toBeInstanceOf(PlainError)
  })
  it('fails the pack on a nested link, naming it relative to the pack', async () => {
    const dir = addOns()
    fs.symlinkSync(path.join(dir, 'Pack_x', 'a.ogg'), path.join(dir, 'Pack_x', 'link.ogg'))
    const err = await zipFolder(dir, 'Pack_x', path.join(tmpDir(), 'o.zip'), signal).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toContain('link.ogg')
    expect(err.message).not.toContain(dir)
  })
})

type Handler = (req: http.IncomingMessage, body: Buffer, res: http.ServerResponse) => void

/** A local server, with a real fetch whose store hosts are rewritten to it. */
async function serve(handler: Handler): Promise<{ fetchImpl: typeof fetch; close: () => void }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => handler(req, Buffer.concat(chunks), res))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input))
    return fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, init)
  }) as typeof fetch
  return { fetchImpl, close: () => server.close() }
}

describe('odd answers and missing files', () => {
  it('a missing zip is a PlainError from both uploaders', async () => {
    const s = await serve((req, _b, res) => res.end(JSON.stringify(release([]))))
    const gone = path.join(tmpDir(), 'gone.zip')
    try {
      await expect(uploadCurseForge(cfArgs(s.fetchImpl, gone))).rejects.toBeInstanceOf(PlainError)
      await expect(uploadGitHub(ghArgs(s.fetchImpl, gone))).rejects.toBeInstanceOf(PlainError)
    } finally {
      s.close()
    }
  })
  it.each([[null], [[]], ['text']])('a release body of %j is a PlainError', async (body) => {
    const s = await serve((_r, _b, res) => res.end(JSON.stringify(body)))
    try {
      await expect(uploadGitHub(ghArgs(s.fetchImpl, bigZip().file))).rejects.toBeInstanceOf(PlainError)
    } finally {
      s.close()
    }
  })
  it.each([[[null]], ['x'], [[7, 'y']]])('release assets %j are ignored, not a TypeError', async (assets) => {
    const s = await serve((req, _b, res) => {
      res.statusCode = req.method === 'GET' ? 200 : 201
      res.end(JSON.stringify(req.method === 'GET' ? release(assets as unknown[]) : {}))
    })
    try {
      const r = await uploadGitHub(ghArgs(s.fetchImpl, bigZip().file))
      expect(r.alreadyThere).toBe(false)
    } finally {
      s.close()
    }
  })
})

describe('against a local server', () => {
  it('sends CurseForge a multipart with the metadata and the file bytes', async () => {
    const { file, bytes } = bigZip()
    let got: { type: string; length: string; body: Buffer } | null = null
    const s = await serve((req, body, res) => {
      got = { type: String(req.headers['content-type']), length: String(req.headers['content-length']), body }
      res.end('{"id":42}')
    })
    try {
      const r = await uploadCurseForge(cfArgs(s.fetchImpl, file))
      expect(r.fileId).toBe('42')
    } finally {
      s.close()
    }
    const { type, length, body } = got!
    expect(Number(length)).toBe(body.length)
    const boundary = /boundary=(.+)$/.exec(type)![1]!
    const parts = body.toString('latin1').split(`--${boundary}`).slice(1, -1)
    expect(parts).toHaveLength(2)
    const [metaPart, filePart] = parts as [string, string]
    expect(metaPart).toContain('name="metadata"')
    const meta = JSON.parse(metaPart.split('\r\n\r\n')[1]!.replace(/\r\n$/, ''))
    expect(meta.displayName).toBe('Pack_x 1.2.3')
    expect(meta.relations.projects[0].slug).toBe('spoken')
    expect(filePart).toContain('filename="Pack_x-1.2.3.zip"')
    expect(filePart).toContain('Content-Type: application/octet-stream')
    const content = filePart.slice(filePart.indexOf('\r\n\r\n') + 4, -2)
    expect(Buffer.from(content, 'latin1').equals(bytes)).toBe(true)
  })

  it('refuses a redirect from the CurseForge upload', async () => {
    const s = await serve((_r, _b, res) => {
      res.statusCode = 302
      res.setHeader('Location', 'http://127.0.0.1:1/elsewhere')
      res.end()
    })
    try {
      await expect(uploadCurseForge(cfArgs(s.fetchImpl, bigZip().file))).rejects.toBeInstanceOf(PlainError)
    } finally {
      s.close()
    }
  })

  it('sends GitHub the zip bytes with the right length and refuses a redirect', async () => {
    const { file, bytes } = bigZip()
    let uploaded: { length: string; body: Buffer } | null = null
    const s = await serve((req, body, res) => {
      if (req.method === 'GET') return res.end(JSON.stringify(release([])))
      uploaded = { length: String(req.headers['content-length']), body }
      res.statusCode = 201
      res.end('{}')
    })
    try {
      await uploadGitHub(ghArgs(s.fetchImpl, file))
    } finally {
      s.close()
    }
    expect(Number(uploaded!.length)).toBe(bytes.length)
    expect(uploaded!.body.equals(bytes)).toBe(true)

    const r = await serve((req, _b, res) => {
      if (req.method === 'GET') return res.end(JSON.stringify(release([])))
      res.statusCode = 302
      res.setHeader('Location', 'http://127.0.0.1:1/elsewhere')
      res.end()
    })
    try {
      await expect(uploadGitHub(ghArgs(r.fetchImpl, file))).rejects.toBeInstanceOf(PlainError)
    } finally {
      r.close()
    }
  })
})

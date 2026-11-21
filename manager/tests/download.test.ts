import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadAsset } from '../src/main/download'
import { isAbortError, PlainError } from '../src/main/errors'
import { serveBuffer, sha256, startServer, tmpDir, writePart, type TestServer } from './helpers'

const DATA = randomBytes(300_000)
let server: TestServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

const base = (extra: object = {}) => ({
  baseName: 'pack-1.0.0',
  expectedSize: DATA.length,
  digest: `sha256:${sha256(DATA)}`,
  backoffMs: 1,
  ...extra
})

describe('downloadAsset', () => {
  let dir: string
  beforeEach(() => {
    dir = tmpDir()
  })

  it('follows a redirect, reports progress and ends with a verified .zip and no .part', async () => {
    server = await startServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/cdn/file' })
        return res.end()
      }
      serveBuffer(req, res, DATA)
    })
    const progress: [number, number][] = []
    const result = await downloadAsset({
      url: `${server.url}/start`,
      dir,
      ...base(),
      userAgent: 'SpokenManager/0.1.0',
      onProgress: (received, total) => progress.push([received, total])
    })
    expect(result.file).toBe(path.join(dir, 'pack-1.0.0.zip'))
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
    expect(fs.existsSync(`${result.file}.part`)).toBe(false)
    expect(progress.at(-1)).toEqual([DATA.length, DATA.length])
    expect(server.requests.map((r) => r.url)).toEqual(['/start', '/cdn/file'])
    expect(server.requests[0]!.userAgent).toBe('SpokenManager/0.1.0')
    expect(server.requests[0]!.range).toBeUndefined()
    expect(server.requests.every((r) => r.authorization === undefined)).toBe(true)
  })

  it('resumes a .part file with a Range header', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    writePart(dir, 'pack-1.0.0', DATA.subarray(0, 100_000))
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]!.range).toBe('bytes=100000-')
    expect(result.fetched).toBe(DATA.length - 100_000)
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
  })

  it('sends If-Range with the saved validator and resumes when the server says 206', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA, '"v1"'))
    writePart(dir, 'pack-1.0.0', DATA.subarray(0, 100_000), { etag: '"v1"' })
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(server.requests[0]!.range).toBe('bytes=100000-')
    expect(server.requests[0]!.ifRange).toBe('"v1"')
    expect(result.fetched).toBe(DATA.length - 100_000)
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
    expect(fs.readdirSync(dir)).toEqual(['pack-1.0.0.zip'])
  })

  it('uses Last-Modified when there is no strong ETag', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    writePart(dir, 'pack-1.0.0', DATA.subarray(0, 1000), { etag: 'W/"weak"', lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT' })
    await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(server.requests[0]!.ifRange).toBe('Wed, 21 Oct 2026 07:28:00 GMT')
  })

  it('starts the file again when the server answers 200 because the file changed', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA, '"v2"'))
    // The .part is the start of some other version of the file.
    writePart(dir, 'pack-1.0.0', randomBytes(100_000), { etag: '"v1"' })
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(server.requests[0]!.ifRange).toBe('"v1"')
    expect(result.fetched).toBe(DATA.length)
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
  })

  it('does not resume a .part that has no record beside it', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    fs.writeFileSync(path.join(dir, 'pack-1.0.0.zip.part'), DATA.subarray(0, 100_000))
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(server.requests[0]!.range).toBeUndefined()
    expect(result.fetched).toBe(DATA.length)
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
  })

  it('keeps the record of a part that was cut short, and saves the validator of a new one', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': DATA.length, ETag: '"v9"', 'Last-Modified': 'Wed, 21 Oct 2026 07:28:00 GMT' })
      res.write(DATA.subarray(0, 50_000))
      // never finished
    })
    const controller = new AbortController()
    const err = await downloadAsset({
      url: `${server.url}/file`,
      dir,
      ...base(),
      signal: controller.signal,
      onProgress: () => controller.abort()
    }).catch((e) => e)
    expect(isAbortError(err)).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'pack-1.0.0.zip.part.meta'), 'utf8'))).toEqual({
      etag: '"v9"',
      lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT'
    })
  })

  it('starts again when the server ignores the Range header', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': DATA.length })
      res.end(DATA)
    })
    writePart(dir, 'pack-1.0.0', DATA.subarray(0, 50_000))
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(server.requests[0]!.range).toBe('bytes=50000-')
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
  })

  it('verifies and finishes a complete .part without asking the server', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    writePart(dir, 'pack-1.0.0', DATA)
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(server.requests).toHaveLength(0)
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
  })

  it('treats a 416 on resume as "already complete" and verifies the file', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    writePart(dir, 'pack-1.0.0', DATA)
    // The size is not known in advance here, so the request goes out and the server answers 416.
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...base({ expectedSize: 0 }) })
    expect(server.requests[0]!.range).toBe(`bytes=${DATA.length}-`)
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
  })

  it('reuses a finished .zip that still matches, and fetches again when it does not', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    fs.writeFileSync(path.join(dir, 'pack-1.0.0.zip'), DATA)
    const reused = await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(reused.fetched).toBe(0)
    expect(server.requests).toHaveLength(0)

    fs.writeFileSync(path.join(dir, 'pack-1.0.0.zip'), randomBytes(DATA.length))
    const again = await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(again.fetched).toBe(DATA.length)
    expect(fs.readFileSync(again.file).equals(DATA)).toBe(true)
  })

  it('deletes the file and fails in plain words on a size mismatch', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    const err = await downloadAsset({ url: `${server.url}/file`, dir, ...base({ expectedSize: DATA.length + 10 }) }).catch((e) => e)
    // The server sent fewer bytes than promised, so this is retried and then stops; the file is never accepted.
    expect(err).toBeInstanceOf(PlainError)
    expect(fs.existsSync(path.join(dir, 'pack-1.0.0.zip'))).toBe(false)
  })

  it('deletes a too-big file on a size mismatch', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    const err = await downloadAsset({ url: `${server.url}/file`, dir, ...base({ expectedSize: DATA.length - 10 }) }).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/does not match/)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('deletes the file and fails in plain words on a digest mismatch', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    const err = await downloadAsset({
      url: `${server.url}/file`,
      dir,
      ...base({ digest: `sha256:${'00'.repeat(32)}` })
    }).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/does not match what GitHub published/)
    expect(fs.readdirSync(dir)).toEqual([])
    expect(server.requests).toHaveLength(1)
  })

  it('checks the digest of a resumed file too', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    const damaged = Buffer.from(DATA.subarray(0, 100_000))
    damaged[10] = damaged[10]! ^ 0xff
    writePart(dir, 'pack-1.0.0', damaged)
    const err = await downloadAsset({ url: `${server.url}/file`, dir, ...base() }).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('works without a digest when the size is right', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    const { digest: _digest, ...rest } = base()
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...rest })
    expect(fs.statSync(result.file).size).toBe(DATA.length)
  })

  it('cancels through the AbortSignal and keeps the .part for a later resume', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': DATA.length })
      res.write(DATA.subarray(0, 120_000))
      // The rest never comes.
    })
    const controller = new AbortController()
    const promise = downloadAsset({
      url: `${server.url}/file`,
      dir,
      ...base(),
      signal: controller.signal,
      onProgress: (received) => {
        if (received > 0) controller.abort()
      }
    })
    const err = await promise.catch((e) => e)
    expect(isAbortError(err)).toBe(true)
    expect(fs.existsSync(path.join(dir, 'pack-1.0.0.zip'))).toBe(false)
    expect(fs.statSync(path.join(dir, 'pack-1.0.0.zip.part')).size).toBeGreaterThan(0)
  })

  it('is cancelled at once when the signal is already aborted', async () => {
    server = await startServer((req, res) => serveBuffer(req, res, DATA))
    const controller = new AbortController()
    controller.abort()
    const err = await downloadAsset({ url: `${server.url}/file`, dir, ...base(), signal: controller.signal }).catch((e) => e)
    expect(isAbortError(err)).toBe(true)
    expect(server.requests).toHaveLength(0)
  })

  it('resumes after the connection drops half way', async () => {
    server = await startServer((req, res, n) => {
      if (n === 1) {
        res.writeHead(200, { 'Content-Length': DATA.length })
        res.write(DATA.subarray(0, 150_000))
        setTimeout(() => res.destroy(), 30)
        return
      }
      serveBuffer(req, res, DATA)
    })
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...base() })
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1]!.range).toMatch(/^bytes=\d+-$/)
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
  })

  it('gives up on a server that goes silent mid-body and resumes from what arrived', async () => {
    server = await startServer((req, res, n) => {
      if (n === 1) {
        res.writeHead(200, { 'Content-Length': DATA.length })
        res.write(DATA.subarray(0, 150_000))
        // The rest never comes, and the connection stays open.
        return
      }
      serveBuffer(req, res, DATA)
    })
    const result = await downloadAsset({ url: `${server.url}/file`, dir, ...base(), stallMs: 100 })
    expect(server.requests).toHaveLength(2)
    expect(server.requests[1]!.range).toMatch(/^bytes=\d+-$/)
    expect(fs.readFileSync(result.file).equals(DATA)).toBe(true)
  })

  it('gives up on a server that never answers and says why', async () => {
    server = await startServer(() => undefined)
    const err = await downloadAsset({ url: `${server.url}/file`, dir, ...base(), stallMs: 50, attempts: 2 }).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toContain('the server stopped sending data')
    expect(server.requests).toHaveLength(2)
  })

  it('is a cancel, not a retry, when the player cancels during a silence', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': DATA.length })
      res.write(DATA.subarray(0, 150_000))
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 50)
    const err = await downloadAsset({ url: `${server.url}/file`, dir, ...base(), signal: controller.signal }).catch((e) => e)
    expect(isAbortError(err)).toBe(true)
    expect(server.requests).toHaveLength(1)
  })

  it('aborts the request when it walks away from a body', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(206, { 'Content-Length': DATA.length, 'Content-Range': `bytes 5-${DATA.length}/${DATA.length}` })
      res.write(DATA.subarray(0, 1000))
    })
    writePart(dir, 'pack-1.0.0', DATA.subarray(0, 100_000))
    const signals: AbortSignal[] = []
    const fetchImpl: typeof fetch = (input, init) => {
      signals.push(init!.signal!)
      return fetch(input, init)
    }
    await downloadAsset({ url: `${server.url}/file`, dir, ...base(), attempts: 1, fetchImpl }).catch(() => undefined)
    expect(signals).toHaveLength(1)
    expect(signals[0]!.aborted).toBe(true)
  })

  it('retries a 503 and gives up after three attempts with a message that says the part is kept', async () => {
    server = await startServer((_req, res, n) => {
      res.writeHead(503)
      res.end()
      void n
    })
    const err = await downloadAsset({ url: `${server.url}/file`, dir, ...base() }).catch((e) => e)
    expect(server.requests).toHaveLength(3)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/stopped before it finished/)
  })

  it('does not retry a 404', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    const err = await downloadAsset({ url: `${server.url}/file`, dir, ...base() }).catch((e) => e)
    expect(server.requests).toHaveLength(1)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/no longer has this file/)
  })
})

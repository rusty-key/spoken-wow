// Shared test fixtures: temp folders, zips, a fake WoW install, a local HTTP server.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach } from 'vitest'
import yazl from 'yazl'
import type { GameInstall, JobProgress, ReleaseInfo } from '../src/shared/types'
import { describeFlavorFolder } from '../src/main/games'

const made: string[] = []

export function tmpDir(prefix = 'spl-'): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  made.push(dir)
  return dir
}

afterEach(() => {
  while (made.length > 0) {
    const dir = made.pop()!
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch {
      /* temp folder left behind */
    }
  }
})

export function write(file: string, text: string | Buffer = ''): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

// ---------------------------------------------------------------- zips

export interface ZipEntry {
  name: string
  data?: string | Buffer
  /** What the table of contents claims the file unpacks to (rawZip only), to test limits without making big files. */
  declaredSize?: number
}

/** A normal zip (deflated) made with yazl. */
export function yazlZip(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    for (const e of entries) {
      if (e.name.endsWith('/')) zip.addEmptyDirectory(e.name)
      else zip.addBuffer(Buffer.from(e.data ?? ''), e.name)
    }
    zip.end()
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
  })
}

/** A stored zip with the names exactly as given (yazl refuses `..` and absolute paths; this does not). */
export function rawZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const data = Buffer.from(e.data ?? '')
    const crc = zlib.crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(e.declaredSize ?? data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(e.declaredSize ?? data.length, 20)
    central.writeUInt32LE(e.declaredSize ?? data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

// ---------------------------------------------------------------- a fake WoW install

/** `<tmp>/World of Warcraft/<flavorFolder>` with Interface\AddOns and WTF, plus Blizzard's info files. */
export function makeGameFolders(
  base: string,
  options: { flavorFolder?: string; product?: string; version?: string } = {}
): string {
  const flavorFolder = options.flavorFolder ?? '_forever_'
  const product = options.product ?? 'wow_forever'
  const gameRoot = path.join(base, 'World of Warcraft')
  const flavor = path.join(gameRoot, flavorFolder)
  fs.mkdirSync(path.join(flavor, 'Interface', 'AddOns'), { recursive: true })
  fs.mkdirSync(path.join(flavor, 'WTF'), { recursive: true })
  write(path.join(flavor, '.flavor.info'), `Product Flavor!STRING:0\n${product}\n`)
  write(
    path.join(gameRoot, '.build.info'),
    `Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|Version!STRING:0|Product!STRING:0\n` +
      `us|1|abc|${options.version ?? '1.60.1.70450'}|${product}\n`
  )
  return flavor
}

export async function makeGame(
  base: string,
  options: { flavorFolder?: string; product?: string; version?: string } = {}
): Promise<GameInstall> {
  const game = await describeFlavorFolder(makeGameFolders(base, options), 'manual')
  if (!game) throw new Error('fixture game not recognised')
  return game
}

export function toc(name: string, version: string): string {
  return `## Interface: 120000\n## Title: ${name}\n## Version: ${version}\n${name}.lua\n`
}

export function listDir(dir: string): string[] {
  return fs.readdirSync(dir).sort()
}

// ---------------------------------------------------------------- http

export interface TestServer {
  url: string
  requests: { url: string; range?: string; ifRange?: string; userAgent?: string; authorization?: string }[]
  close(): Promise<void>
}

export async function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void): Promise<TestServer> {
  const requests: TestServer['requests'] = []
  let count = 0
  const server = http.createServer((req, res) => {
    requests.push({
      url: req.url ?? '',
      ...(req.headers.range ? { range: req.headers.range } : {}),
      ...(req.headers['if-range'] ? { ifRange: String(req.headers['if-range']) } : {}),
      ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
      ...(req.headers.authorization ? { authorization: req.headers.authorization } : {})
    })
    handler(req, res, ++count)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections()
        server.close(() => r())
      })
  }
}

/** Serves `data` with Range support (206, 416). With `etag`, sends it and answers 200 to a Range whose If-Range differs. */
export function serveBuffer(req: http.IncomingMessage, res: http.ServerResponse, data: Buffer, etag?: string): void {
  const m = /^bytes=(\d+)-/.exec(req.headers.range ?? '')
  const ifRange = req.headers['if-range']
  const sameFile = !etag || ifRange === undefined || ifRange === etag
  const extra: Record<string, string> = etag ? { ETag: etag } : {}
  if (m && sameFile) {
    const start = Number(m[1])
    if (start >= data.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${data.length}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'Content-Length': data.length - start,
      'Content-Range': `bytes ${start}-${data.length - 1}/${data.length}`,
      'Content-Type': 'application/octet-stream',
      ...extra
    })
    res.end(data.subarray(start))
    return
  }
  res.writeHead(200, { 'Content-Length': data.length, 'Content-Type': 'application/octet-stream', ...extra })
  res.end(data)
}

/** A half-finished download as the manager leaves it: the .part and its record of what the server said. */
export function writePart(dir: string, baseName: string, data: Buffer, validator: { etag?: string; lastModified?: string } = {}): string {
  const part = path.join(dir, `${baseName}.zip.part`)
  fs.writeFileSync(part, data)
  fs.writeFileSync(`${part}.meta`, JSON.stringify(validator))
  return part
}

export function release(productId: string, version: string, zip: Buffer, url: string, extra: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    productId,
    tag: `${productId}/v${version}`,
    version,
    prerelease: false,
    publishedAt: '2026-10-01T00:00:00Z',
    notes: '',
    assetName: `${productId}-${version}.zip`,
    assetSize: zip.length,
    assetUrl: url,
    digest: `sha256:${sha256(zip)}`,
    htmlUrl: '',
    ...extra
  }
}

export function collect(): { events: JobProgress[]; emit: (p: JobProgress) => void } {
  const events: JobProgress[] = []
  return { events, emit: (p) => events.push(p) }
}

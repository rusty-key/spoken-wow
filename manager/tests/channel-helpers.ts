// A manager channel in miniature: keys, sealed index and manifests, blobs, and a server for them.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type http from 'node:http'
import { sha256, startServer, type TestServer } from './helpers'

export interface ChannelKeys {
  publicKey: string
  privateKey: KeyObject
}

export function channelKeys(): ChannelKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey }
}

export function seal(value: unknown, keys: ChannelKeys): { text: string; signed: string } {
  const signed = JSON.stringify(value)
  return { signed, text: JSON.stringify({ signed, sig: sign(null, Buffer.from(signed, 'utf8'), keys.privateKey).toString('base64') }) }
}

export interface PackSpec {
  packId: string
  rev: string
  files: Record<string, string>
  requires?: string
  /** index-v2.json's team for the pack; none is a page pack's. */
  team?: { slug: string; name: string; official: boolean }
}

type V1Entry = { rev: string; manifestSha256: string; fileCount: number; totalSize: number; requires: { Spoken: string } }
type V2Entry = V1Entry & { lang: string | null; section: string | null; pack: string | null; team: PackSpec['team'] | null }

export interface ChannelFixture {
  /** Request path (`/index.json`, `/index-v2.json`, `/packs/<id>/<rev>.json`, `/blobs/<sha>`) to body. */
  objects: Map<string, Buffer>
  index: { generatedAt: string; packs: Record<string, V1Entry> }
  indexV2: { generatedAt: string; packs: Record<string, V2Entry>; languages: Record<string, { code: string; name: string; native: string }> }
  manifestSigned: Record<string, string>
}

// The ids index.json carries: an older Manager refuses the whole index over one it does not accept.
const LEGACY_PACK_ID = /^Spoken[A-Za-z]+(_[a-z]{2}[A-Z]{2})?$/
const FOLDER = /^Spoken(Quests|Places|Readables|Bosses)Audio(Alliance|Horde|Shared|Gossip)?(?:_([a-z]{2}[A-Z]{2})(?:_([a-z][a-z0-9-]{1,40}))?)?$/

/** What scripts/lib/packs.mjs `describeFolder` reads from a folder's name, as the publisher writes it to index-v2.json. */
function describe(folder: string): { lang: string | null; section: string | null; pack: string | null } {
  const m = FOLDER.exec(folder)
  if (!m) return { lang: null, section: null, pack: null }
  return { section: m[1]!.toLowerCase(), pack: m[2] ? m[2].toLowerCase() : null, lang: m[3] ?? 'enUS' }
}

export interface FixtureOptions {
  generatedAt?: string
  /** A channel from before index-v2.json: only index.json is served. */
  v1Only?: boolean
  languages?: Record<string, { code: string; name: string; native: string }>
}

export function channelFixture(keys: ChannelKeys, packs: PackSpec[], options: FixtureOptions = {}): ChannelFixture {
  const objects = new Map<string, Buffer>()
  const generatedAt = options.generatedAt ?? '2026-10-18T00:00:00.000Z'
  const fx: ChannelFixture = { objects, index: { generatedAt, packs: {} }, indexV2: { generatedAt, packs: {}, languages: options.languages ?? {} }, manifestSigned: {} }
  for (const p of packs) {
    const files = Object.entries(p.files).map(([path, text]) => {
      const body = Buffer.from(text)
      objects.set(`/blobs/${sha256(body)}`, body)
      return { path, sha256: sha256(body), size: body.length }
    })
    const requires = { Spoken: `>=${p.requires ?? '3.0.0'}` }
    const totalSize = files.reduce((n, f) => n + f.size, 0)
    const sealed = seal({ packId: p.packId, rev: p.rev, requires, fileCount: files.length, totalSize, files }, keys)
    objects.set(`/packs/${p.packId}/${p.rev}.json`, Buffer.from(sealed.text))
    fx.manifestSigned[p.packId] = sealed.signed
    const entry = { rev: p.rev, manifestSha256: sha256(sealed.signed), fileCount: files.length, totalSize, requires }
    if (LEGACY_PACK_ID.test(p.packId)) fx.index.packs[p.packId] = entry
    fx.indexV2.packs[p.packId] = { ...entry, ...describe(p.packId), team: p.team ?? null }
  }
  objects.set('/index.json', Buffer.from(seal(fx.index, keys).text))
  if (!options.v1Only) objects.set('/index-v2.json', Buffer.from(seal(fx.indexV2, keys).text))
  return fx
}

/** Serves a fixture. `hook` may answer a request itself (return true), to fail or corrupt it. */
export async function serveChannel(
  fx: { objects: Map<string, Buffer> },
  hook?: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => boolean
): Promise<TestServer & { base: string }> {
  const server = await startServer((req, res, n) => {
    if (hook?.(req, res, n)) return
    const body = fx.objects.get(req.url ?? '')
    if (!body) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Length': body.length })
    res.end(body)
  })
  return Object.assign(server, { base: `${server.url}/` })
}

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
}

export interface ChannelFixture {
  /** Request path (`/index.json`, `/packs/<id>/<rev>.json`, `/blobs/<sha>`) to body. */
  objects: Map<string, Buffer>
  index: { generatedAt: string; packs: Record<string, { rev: string; manifestSha256: string; fileCount: number; totalSize: number; requires: { Spoken: string } }> }
  manifestSigned: Record<string, string>
}

export function channelFixture(keys: ChannelKeys, packs: PackSpec[]): ChannelFixture {
  const objects = new Map<string, Buffer>()
  const fx: ChannelFixture = { objects, index: { generatedAt: '2026-10-18T00:00:00.000Z', packs: {} }, manifestSigned: {} }
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
    fx.index.packs[p.packId] = { rev: p.rev, manifestSha256: sha256(sealed.signed), fileCount: files.length, totalSize, requires }
  }
  objects.set('/index.json', Buffer.from(seal(fx.index, keys).text))
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

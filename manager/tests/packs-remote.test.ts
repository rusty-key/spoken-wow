import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchIndex, fetchManifest, isSafePackPath, loadCachedIndex, openEnvelope, parseIndex, parseManifest } from '../src/main/packs-remote'
import { channelFixture, channelKeys, seal, serveChannel } from './channel-helpers'
import { tmpDir, type TestServer } from './helpers'

let server: TestServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

const keys = channelKeys()
const pack = { packId: 'SpokenPlacesAudio_deDE', rev: '20261018T000000Z', files: { 'SpokenPlacesAudio_deDE.toc': 'toc', 'Sounds/1.ogg': 'one' } }

describe('parseIndex: addons', () => {
  const good = { version: '3.8.3', sha256: 'c'.repeat(64), size: 9 }
  const text = (addons: unknown): string => JSON.stringify({ generatedAt: 'now', packs: {}, addons })

  it('reads the copies of an addon', () => {
    expect(parseIndex(text({ spoken: [good] })).addons).toEqual({ spoken: [good] })
  })
  it('has none on an index from before they existed', () => {
    expect(parseIndex(JSON.stringify({ generatedAt: 'now', packs: {} })).addons).toEqual({})
  })
  it('drops a bad copy and keeps the channel usable', () => {
    const bad = [{ ...good, sha256: 'nope' }, { ...good, size: 0 }, { ...good, version: '../x' }, null]
    expect(parseIndex(text({ spoken: [...bad, good], other: 'x' })).addons).toEqual({ spoken: [good] })
    expect(parseIndex(text('x')).addons).toEqual({})
  })
})

describe('openEnvelope', () => {
  it('returns the signed text when the signature checks out', () => {
    expect(openEnvelope(seal({ a: 1 }, keys).text, keys.publicKey)).toBe('{"a":1}')
  })
  it('refuses a changed text', () => {
    const env = JSON.parse(seal({ a: 1 }, keys).text) as { signed: string }
    env.signed = '{"a":2}'
    expect(() => openEnvelope(JSON.stringify(env), keys.publicKey)).toThrow(/bad signature/)
  })
  it('refuses another key', () => {
    expect(() => openEnvelope(seal({ a: 1 }, keys).text, channelKeys().publicKey)).toThrow(/bad signature/)
  })
  it('refuses plain JSON', () => {
    expect(() => openEnvelope('{"a":1}', keys.publicKey)).toThrow(/no signature/)
  })
})

describe('isSafePackPath', () => {
  it('refuses escapes, drives, backslashes and trailing dots and device names', () => {
    for (const p of ['', '/a', 'C:/a', 'a/../b', '..', 'a\\b', 'a/b.', 'a//b', 'a/b ', 'CON', 'con.ogg', 'a/NUL.txt', 'Sounds/com1.ogg', 'lpt9']) expect(isSafePackPath(p), p).toBe(false)
    for (const p of ['a.ogg', 'generated/sounds/quests/20-accept.ogg', 'x~Voice.ogg', 'console.ogg', 'COM0.ogg']) expect(isSafePackPath(p), p).toBe(true)
  })
})

describe('parseManifest', () => {
  it('accepts the manifest the index names', () => {
    const fx = channelFixture(keys, [pack])
    const m = parseManifest(fx.manifestSigned[pack.packId]!, pack.packId, parseIndex(JSON.stringify(fx.index)).packs[pack.packId]!)
    expect(m.files.map((f) => f.path)).toEqual(['SpokenPlacesAudio_deDE.toc', 'Sounds/1.ogg'])
  })
  it('refuses an older, validly signed manifest in place of the current one', () => {
    const old = channelFixture(keys, [{ ...pack, rev: '20261001T000000Z' }])
    const now = channelFixture(keys, [pack])
    expect(() => parseManifest(old.manifestSigned[pack.packId]!, pack.packId, now.index.packs[pack.packId]!)).toThrow(/not the one the index names/)
  })
  it('refuses a path listed twice in different case', () => {
    const fx = channelFixture(keys, [{ ...pack, files: { 'SpokenPlacesAudio_deDE.toc': 't', 'a.ogg': '1', 'A.ogg': '2' } }])
    expect(() => parseManifest(fx.manifestSigned[pack.packId]!, pack.packId, fx.index.packs[pack.packId]!)).toThrow(/twice/)
  })
  it('refuses a manifest with no .toc at its root', () => {
    const fx = channelFixture(keys, [{ ...pack, files: { 'Sounds/1.ogg': 'one', 'Sub/SpokenPlacesAudio_deDE.toc': 'nested' } }])
    expect(() => parseManifest(fx.manifestSigned[pack.packId]!, pack.packId, fx.index.packs[pack.packId]!)).toThrow(/no SpokenPlacesAudio_deDE\.toc/)
  })
  it('refuses an unsafe path', () => {
    const fx = channelFixture(keys, [{ ...pack, files: { 'SpokenPlacesAudio_deDE.toc': 't', '../Spoken/evil.lua': 'x' } }])
    expect(() => parseManifest(fx.manifestSigned[pack.packId]!, pack.packId, fx.index.packs[pack.packId]!)).toThrow(/file entry/)
  })
})

describe('fetching', () => {
  it('fetches and caches the index, and falls back to the cache offline', async () => {
    const fx = channelFixture(keys, [pack])
    const s = await serveChannel(fx)
    server = s
    const data = tmpDir()
    const online = await fetchIndex(data, { baseUrl: s.base, publicKey: keys.publicKey })
    expect(online.offline).toBe(false)
    expect(online.index?.packs[pack.packId]?.rev).toBe(pack.rev)
    await s.close()
    server = null
    const offline = await fetchIndex(data, { baseUrl: s.base, publicKey: keys.publicKey })
    expect(offline.offline).toBe(true)
    expect(offline.index?.packs[pack.packId]?.rev).toBe(pack.rev)
    expect(loadCachedIndex(data, channelKeys().publicKey)).toBeNull()
  })
  it('keeps the saved index when the server answers with an older one', async () => {
    const fx = channelFixture(keys, [pack])
    const s = await serveChannel(fx)
    server = s
    const data = tmpDir()
    await fetchIndex(data, { baseUrl: s.base, publicKey: keys.publicKey })
    fx.objects.set('/index.json', Buffer.from(seal({ generatedAt: '2026-10-17T00:00:00.000Z', packs: {} }, keys).text))
    const again = await fetchIndex(data, { baseUrl: s.base, publicKey: keys.publicKey })
    expect(again.offline).toBe(false)
    expect(again.index?.packs[pack.packId]?.rev).toBe(pack.rev)
    expect(loadCachedIndex(data, keys.publicKey)?.generatedAt).toBe(fx.index.generatedAt)
  })
  it('fetches a manifest once and reads it from disk after', async () => {
    const fx = channelFixture(keys, [pack])
    const s = await serveChannel(fx)
    server = s
    const data = tmpDir()
    const entry = fx.index.packs[pack.packId]!
    await fetchManifest(data, pack.packId, entry, { baseUrl: s.base, publicKey: keys.publicKey })
    await fetchManifest(data, pack.packId, entry, { baseUrl: s.base, publicKey: keys.publicKey })
    expect(s.requests.filter((r) => r.url.startsWith('/packs/')).length).toBe(1)
    expect(fs.readdirSync(path.join(data, 'manifests'))).toEqual([`${pack.packId}-${pack.rev}.json`])
  })
})

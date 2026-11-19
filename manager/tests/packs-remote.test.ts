import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchIndex, fetchManifest, fromV1, isSafePackPath, loadCachedIndex, openEnvelope, parseIndex, parseIndexV2, parseManifest } from '../src/main/packs-remote'
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

const STIMMEN = { slug: 'stimmen', name: 'Stimmen', official: false }
const teamPack = { packId: 'SpokenPlacesAudio_deDE_stimmen', rev: '20261019T000000Z', files: { 'SpokenPlacesAudio_deDE_stimmen.toc': 'toc' }, team: STIMMEN }

describe('parseIndexV2', () => {
  const v2 = (packs: Record<string, unknown>, languages: unknown = {}): string => JSON.stringify({ generatedAt: 'now', packs, languages })
  const entry = { rev: '20261018T000000Z', manifestSha256: 'a'.repeat(64), fileCount: 1, totalSize: 3, requires: { Spoken: '>=3.0.0' } }

  it("reads each pack's language, section, quests side and team, and the languages' names", () => {
    const index = parseIndexV2(
      v2(
        {
          SpokenPlacesAudio_deDE_stimmen: { ...entry, lang: 'deDE', section: 'places', pack: null, team: STIMMEN },
          SpokenQuestsAudioHorde_jaJP: { ...entry, lang: 'jaJP', section: 'quests', pack: 'horde', team: { slug: 'nihongo', name: 'Nihongo', official: true } },
          SpokenPlacesAudio_deDE: { ...entry, lang: 'deDE', section: 'places', pack: null, team: null }
        },
        { jaJP: { code: 'jaJP', name: 'Japanese', native: '日本語' } }
      )
    )
    expect(index.packs.SpokenPlacesAudio_deDE_stimmen).toEqual({ ...entry, lang: 'deDE', section: 'places', pack: null, team: STIMMEN })
    expect(index.packs.SpokenQuestsAudioHorde_jaJP?.pack).toBe('horde')
    expect(index.packs.SpokenPlacesAudio_deDE?.team).toBeNull()
    expect(index.languages).toEqual({ jaJP: { name: 'Japanese', native: '日本語' } })
  })

  it('drops a bad entry, says which, and keeps every other one', () => {
    const logged: string[] = []
    const good = { ...entry, lang: 'deDE', section: 'places', pack: null, team: null }
    const index = parseIndexV2(
      v2({
        SpokenPlacesAudio_deDE: good,
        SpokenReadablesAudio_deDE: { ...good, section: 'readables', lang: 'de' },
        SpokenBossesAudio_deDE: { ...good, section: 'dungeons' },
        SpokenQuestsAudioHorde_deDE: { ...good, section: 'quests', pack: null },
        SpokenPlacesAudio_frFR: { ...good, lang: 'frFR', rev: 'yesterday' },
        SpokenPlacesAudio_esES: { ...good, lang: 'esES', team: { slug: 'Bad Slug', name: 'x', official: false } },
        'Spoken/../x': good
      }),
      (line) => void logged.push(line)
    )
    expect(Object.keys(index.packs)).toEqual(['SpokenPlacesAudio_deDE'])
    expect(logged).toHaveLength(6)
    expect(logged.join('\n')).toContain('SpokenReadablesAudio_deDE')
  })

  it('drops a language it cannot name', () => {
    const languages = { jaJP: { name: 'Japanese' }, xx: { name: 'X', native: 'X' }, koKR: { name: 'Korean', native: '한국어' } }
    expect(parseIndexV2(v2({}, languages)).languages).toEqual({ koKR: { name: 'Korean', native: '한국어' } })
  })

  it('refuses an index that is not one', () => {
    expect(() => parseIndexV2(JSON.stringify({ packs: {} }))).toThrow(/index shape/)
  })

  it('reads an index.json as v2, placing each id through the products and dropping one it cannot place', () => {
    const index = fromV1(parseIndex(JSON.stringify({ generatedAt: 'now', packs: { SpokenPlacesAudio_deDE: entry, SpokenQuestsAudioGossip: entry, SpokenQuestsAudioActed_deDE: entry } })))
    expect(index.packs).toEqual({
      SpokenPlacesAudio_deDE: { ...entry, lang: 'deDE', section: 'places', pack: null, team: null },
      SpokenQuestsAudioGossip: { ...entry, lang: 'enUS', section: 'quests', pack: 'gossip', team: null }
    })
    expect(index.languages).toEqual({})
  })

  it("accepts a team's pack id", () => {
    expect(Object.keys(parseIndex(JSON.stringify({ generatedAt: 'now', packs: { SpokenPlacesAudio_deDE_stimmen: entry } })).packs)).toEqual(['SpokenPlacesAudio_deDE_stimmen'])
  })
})

describe('fetching index-v2.json', () => {
  const opts = (base: string) => ({ baseUrl: base, publicKey: keys.publicKey })

  it('reads v2 when the channel has both', async () => {
    const s = await serveChannel(channelFixture(keys, [pack, teamPack]))
    server = s
    const got = await fetchIndex(tmpDir(), opts(s.base))
    expect(got.offline).toBe(false)
    expect(got.index?.packs[teamPack.packId]?.team).toEqual(STIMMEN)
    expect(s.requests.map((r) => r.url)).toEqual(['/index-v2.json'])
  })

  it('reads index.json when the channel has no v2, and keeps it for offline use', async () => {
    const s = await serveChannel(channelFixture(keys, [pack], { v1Only: true }))
    server = s
    const data = tmpDir()
    const got = await fetchIndex(data, opts(s.base))
    expect(got.offline).toBe(false)
    expect(got.index?.packs[pack.packId]).toMatchObject({ lang: 'deDE', section: 'places', pack: null, team: null })
    await s.close()
    server = null
    const offline = await fetchIndex(data, opts(s.base))
    expect(offline.offline).toBe(true)
    expect(offline.index?.packs[pack.packId]?.rev).toBe(pack.rev)
  })

  it('refuses a v2 with a bad signature, without reading index.json', async () => {
    const fx = channelFixture(keys, [pack, teamPack])
    fx.objects.set('/index-v2.json', Buffer.from(seal(fx.indexV2, channelKeys()).text))
    const s = await serveChannel(fx)
    server = s
    const got = await fetchIndex(tmpDir(), opts(s.base))
    expect(got.offline).toBe(true)
    expect(got.index).toBeNull()
    expect(got.error).toMatch(/bad signature/)
    expect(s.requests.map((r) => r.url)).not.toContain('/index.json')
  })

  it("keeps a saved v2 newer than the server's", async () => {
    const fx = channelFixture(keys, [pack, teamPack], { generatedAt: '2026-10-19T00:00:00.000Z' })
    const s = await serveChannel(fx)
    server = s
    const data = tmpDir()
    await fetchIndex(data, opts(s.base))
    fx.objects.set('/index-v2.json', Buffer.from(seal({ ...fx.indexV2, generatedAt: '2026-10-18T00:00:00.000Z', packs: {} }, keys).text))
    const again = await fetchIndex(data, opts(s.base))
    expect(again.index?.packs[teamPack.packId]?.team).toEqual(STIMMEN)
    expect(loadCachedIndex(data, keys.publicKey)?.generatedAt).toBe('2026-10-19T00:00:00.000Z')
  })

  it('a saved index.json does not stop a newer v2 being read', async () => {
    const data = tmpDir()
    const old = await serveChannel(channelFixture(keys, [pack], { v1Only: true, generatedAt: '2026-10-18T00:00:00.000Z' }))
    await fetchIndex(data, opts(old.base))
    await old.close()
    const s = await serveChannel(channelFixture(keys, [pack, teamPack], { generatedAt: '2026-10-19T00:00:00.000Z' }))
    server = s
    const got = await fetchIndex(data, opts(s.base))
    expect(got.index?.packs[teamPack.packId]?.team).toEqual(STIMMEN)
    expect(loadCachedIndex(data, keys.publicKey)?.packs[teamPack.packId]).toBeDefined()
  })

  it('keeps the saved v2 when the server has only index.json for a moment', async () => {
    const data = tmpDir()
    const fx = channelFixture(keys, [pack, teamPack])
    const s = await serveChannel(fx)
    server = s
    await fetchIndex(data, opts(s.base))
    fx.objects.delete('/index-v2.json')
    const got = await fetchIndex(data, opts(s.base))
    expect(got.offline).toBe(false)
    expect(got.index?.packs[teamPack.packId]?.team).toEqual(STIMMEN)
  })
})

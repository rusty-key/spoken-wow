// The real publisher (scripts/manager/publish.mjs) against the manager's own readers: what one
// writes, the other must accept, or the channel looks empty to every player.
import { rmSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openEnvelope, parseIndex, parseIndexV2, parseManifest } from '../src/main/packs-remote'
// @ts-expect-error plain JS without declarations
import { promote, publish } from '../../../scripts/manager/publish.mjs'
// @ts-expect-error plain JS without declarations
import { generateKeys } from '../../../scripts/manager/sign.mjs'
// @ts-expect-error plain JS without declarations
import { memoryStore } from '../../../scripts/manager/store.mjs'
import { tmpDir, write } from './helpers'

const PACK = 'SpokenPlacesAudio_deDE'

describe('publisher to manager', () => {
  it('a published pack is accepted by the manager with the same file list', async () => {
    const dist = tmpDir()
    const files = { [`${PACK}.toc`]: '## Title: x', 'Sounds/1.ogg': 'one', 'Sounds/sub/2.ogg': 'two' }
    for (const [p, text] of Object.entries(files)) write(path.join(dist, PACK, ...p.split('/')), text)
    const keys = generateKeys() as { privateKey: string; publicKey: string }
    const store = memoryStore() as { objects: Map<string, { body: Buffer }> }

    await publish({
      store,
      packs: [{ folder: PACK, section: 'places', lang: 'deDE' }],
      distDir: dist,
      signingKey: keys.privateKey,
      minSpoken: { quests: '3.0.0', places: '3.0.0', readables: '3.0.0' },
      latestSpoken: '3.0.0',
      cache: new Map(),
      log: () => undefined
    })

    const index = parseIndex(openEnvelope(store.objects.get('index.json')!.body.toString('utf8'), keys.publicKey))
    const entry = index.packs[PACK]!
    const manifest = parseManifest(openEnvelope(store.objects.get(`packs/${PACK}/${entry.rev}.json`)!.body.toString('utf8'), keys.publicKey), PACK, entry)

    expect(manifest.files.map((f) => f.path).sort()).toEqual(Object.keys(files).sort())
    expect(manifest.fileCount).toBe(3)
    for (const f of manifest.files) {
      expect(store.objects.get(`blobs/${f.sha256}`)!.body.toString('utf8')).toBe(files[f.path as keyof typeof files])
      expect(f.size).toBe(Buffer.byteLength(files[f.path as keyof typeof files]))
    }
  })

  it("index-v2.json is read with each pack's language, section, side and team, and index.json without a team's pack", async () => {
    const TEAM = 'SpokenPlacesAudio_deDE_stimmen'
    const SIDE = 'SpokenQuestsAudioHorde_jaJP'
    const dist = tmpDir()
    for (const folder of [PACK, TEAM, SIDE]) write(path.join(dist, folder, `${folder}.toc`), '## Title: x')
    const keys = generateKeys() as { privateKey: string; publicKey: string }
    const store = memoryStore() as { objects: Map<string, { body: Buffer }> }
    const stimmen = { slug: 'stimmen', name: 'Stimmen', official: false }

    await publish({
      store,
      packs: [
        { folder: PACK, section: 'places', lang: 'deDE' },
        { folder: TEAM, section: 'places', lang: 'deDE', team: stimmen },
        { folder: SIDE, section: 'quests', lang: 'jaJP', pack: 'horde', team: { slug: 'nihongo', name: 'Nihongo', official: true } }
      ],
      languages: [{ code: 'jaJP', name: 'Japanese', native: '日本語' }],
      distDir: dist,
      signingKey: keys.privateKey,
      minSpoken: { quests: '3.0.0', places: '3.0.0', readables: '3.0.0' },
      minSpokenTeam: '3.0.0',
      latestSpoken: '3.0.0',
      cache: new Map(),
      log: () => undefined
    })

    const v2 = parseIndexV2(openEnvelope(store.objects.get('index-v2.json')!.body.toString('utf8'), keys.publicKey))
    expect(Object.keys(v2.packs).sort()).toEqual([PACK, SIDE, TEAM].sort())
    expect(v2.packs[PACK]).toMatchObject({ lang: 'deDE', section: 'places', pack: null, team: null })
    expect(v2.packs[TEAM]).toMatchObject({ lang: 'deDE', section: 'places', pack: null, team: stimmen })
    expect(v2.packs[SIDE]).toMatchObject({ lang: 'jaJP', section: 'quests', pack: 'horde', team: { slug: 'nihongo', official: true } })
    expect(v2.languages.jaJP).toEqual({ name: 'Japanese', native: '日本語' })
    const team = v2.packs[TEAM]!
    expect(parseManifest(openEnvelope(store.objects.get(`packs/${TEAM}/${team.rev}.json`)!.body.toString('utf8'), keys.publicKey), TEAM, team).fileCount).toBe(1)

    const v1 = parseIndex(openEnvelope(store.objects.get('index.json')!.body.toString('utf8'), keys.publicKey))
    expect(Object.keys(v1.packs).sort()).toEqual([PACK, SIDE].sort())
  })

  it('carries a staged update’s line counts to the manager when it goes live', async () => {
    const dist = tmpDir()
    const folder = path.join(dist, PACK)
    write(path.join(folder, `${PACK}.toc`), '## Version: 1.0.0\n')
    write(path.join(folder, 'Sounds/1/01.ogg'), 'one')
    write(path.join(folder, 'Sounds/1/02.ogg'), 'two')
    write(path.join(folder, 'Sounds/2.ogg'), 'removed')
    const { privateKey: signingKey, publicKey } = generateKeys()
    const store = memoryStore()
    const options = {
      store, signingKey, packs: [{ folder: PACK, section: 'places', lang: 'deDE' }],
      distDir: dist, minSpoken: { places: '3.0.0' }, latestSpoken: '3.0.0', cache: new Map(),
      bump: 'patch', log: () => undefined
    }
    const readV2 = () => parseIndexV2(openEnvelope(store.objects.get('index-v2.json').body.toString(), publicKey))
    const first = await publish({ ...options, now: new Date('2026-10-18T00:00:00Z') })
    expect(readV2().packs[PACK]?.changes).toEqual({ added: 2, updated: 0, removed: 0, dataChanged: false })

    rmSync(path.join(folder, 'Sounds/2.ogg'))
    write(path.join(folder, 'Sounds/1/01.ogg'), 'new one')
    write(path.join(folder, 'Sounds/1/02.ogg'), 'new two')
    write(path.join(folder, 'Sounds/3.ogg'), 'added')
    write(path.join(folder, 'Lookup.lua'), 'changed data')
    const { staged } = await publish({ ...options, stage: true, now: new Date('2026-10-19T00:00:00Z') })
    expect(readV2().packs[PACK]?.rev).toBe(first.rev)

    await promote({ store, signingKey, staged, now: new Date('2026-10-20T00:00:00Z'), log: options.log })
    expect(readV2().packs[PACK]?.changes).toEqual({ added: 1, updated: 1, removed: 1, dataChanged: true })
    const v1 = JSON.parse(openEnvelope(store.objects.get('index.json').body.toString(), publicKey))
    expect(v1.packs[PACK]).not.toHaveProperty('changes')
  })
})

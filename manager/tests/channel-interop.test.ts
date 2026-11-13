// The real publisher (scripts/manager/publish.mjs) against the manager's own readers: what one
// writes, the other must accept, or the channel looks empty to every player.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { openEnvelope, parseIndex, parseManifest } from '../src/main/packs-remote'
// @ts-expect-error plain JS without declarations
import { publish } from '../../scripts/manager/publish.mjs'
// @ts-expect-error plain JS without declarations
import { generateKeys } from '../../scripts/manager/sign.mjs'
// @ts-expect-error plain JS without declarations
import { memoryStore } from '../../scripts/manager/store.mjs'
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
})

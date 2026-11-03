import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { productById, PRODUCTS } from '../src/shared/products'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { emptyCatalog } from '../src/main/catalog'
import { isChannelRelease } from '../src/shared/channel'
import { channelRelease, revToIso, withChannel } from '../src/main/packs-catalog'
import type { ChannelIndex } from '../src/main/packs-remote'
import { savePackState } from '../src/main/packs-state'
import type { StateFile } from '../src/main/state'
import { computeStatuses } from '../src/main/status'
import { makeGame, tmpDir, write } from './helpers'

const entry = (rev: string, totalSize = 10) => ({ rev, manifestSha256: 'a'.repeat(64), fileCount: 1, totalSize, requires: { Spoken: '>=3.0.0' } })
const index: ChannelIndex = {
  generatedAt: '',
  packs: {
    SpokenPlacesAudio_deDE: entry('20261018T000000Z'),
    SpokenQuestsAudioAlliance: entry('20261001T000000Z', 1),
    SpokenQuestsAudioHorde: entry('20261002T000000Z', 2),
    SpokenQuestsAudioShared: entry('20261003T000000Z', 3),
    SpokenQuestsAudioGossip: entry('20261004T000000Z', 4)
  }
}
const BASE = 'https://packs.spoken.quest/'

describe('channelRelease', () => {
  it('describes a one-folder pack', () => {
    const r = channelRelease(productById('places-audio-deDE')!, index, BASE)!
    expect(r.tag).toBe('channel/20261018T000000Z')
    expect(r.version).toBe('20261018T000000Z')
    expect(r.publishedAt).toBe('2026-10-18T00:00:00Z')
    expect(isChannelRelease(r)).toBe(true)
  })
  it('joins a bundle\'s revs in folder order and sums its sizes', () => {
    const r = channelRelease(productById('quests-audio')!, index, BASE)!
    expect(r.tag).toBe('channel/20261001T000000Z+20261002T000000Z+20261003T000000Z+20261004T000000Z')
    expect(r.assetSize).toBe(10)
  })
  it('is null when the channel lacks one of the folders, and for Spoken', () => {
    expect(channelRelease(productById('places-audio-frFR')!, index, BASE)).toBeNull()
    expect(channelRelease(productById('spoken')!, index, BASE)).toBeNull()
  })
  it('revToIso reads the rev', () => {
    expect(revToIso('20261018T142233Z')).toBe('2026-10-18T14:22:33Z')
  })
})

describe('withChannel', () => {
  it('replaces a carried product\'s GitHub releases and leaves the rest', () => {
    const gh = { productId: 'places-audio-frFR', tag: 'places-audio-frFR/v1.0.0', version: '1.0.0', prerelease: false, publishedAt: '', notes: '', assetName: '', assetSize: 1, assetUrl: '', htmlUrl: '' }
    const cat = withChannel({ ...emptyCatalog(), releases: { 'places-audio-frFR': [gh], 'places-audio-deDE': [{ ...gh, productId: 'places-audio-deDE' }] } }, PRODUCTS, index, BASE)
    expect(cat.releases['places-audio-frFR']).toEqual([gh])
    expect(cat.releases['places-audio-deDE']?.[0]?.tag).toBe('channel/20261018T000000Z')
  })
})

describe('computeStatuses with the channel', () => {
  const state = (): StateFile => ({ version: 1, manualGames: [], hiddenGames: [], installs: {} })
  const cat = withChannel(emptyCatalog(), PRODUCTS, index, BASE)

  it('up to date when the recorded tag is the channel\'s', async () => {
    const game = await makeGame(tmpDir())
    write(path.join(game.addOnsPath, 'SpokenPlacesAudio_deDE', 'SpokenPlacesAudio_deDE.toc'), '## Version: 1.0.0\n')
    savePackState(game, { packId: 'SpokenPlacesAudio_deDE', rev: '20261018T000000Z', files: {} })
    const s = (await computeStatuses(game, cat, DEFAULT_SETTINGS, state())).find((x) => x.productId === 'places-audio-deDE')
    expect(s?.state).toBe('up-to-date')
  })

  it('a bundle and its split packs both read up to date from their folders\' pack states', async () => {
    const game = await makeGame(tmpDir())
    const revs = {
      SpokenQuestsAudioAlliance: '20261001T000000Z',
      SpokenQuestsAudioHorde: '20261002T000000Z',
      SpokenQuestsAudioShared: '20261003T000000Z',
      SpokenQuestsAudioGossip: '20261004T000000Z'
    }
    for (const [folder, rev] of Object.entries(revs)) {
      write(path.join(game.addOnsPath, folder, `${folder}.toc`), '## Version: 1.0.0\n')
      savePackState(game, { packId: folder, rev, files: {} })
    }
    const statuses = await computeStatuses(game, cat, DEFAULT_SETTINGS, state())
    for (const id of ['quests-audio', 'quests-audio-alliance']) {
      expect(statuses.find((x) => x.productId === id)?.state).toBe('up-to-date')
    }
  })

  it('update available when the tag differs or a folder was installed by another client', async () => {
    const game = await makeGame(tmpDir())
    write(path.join(game.addOnsPath, 'SpokenPlacesAudio_deDE', 'SpokenPlacesAudio_deDE.toc'), '## Version: 1.0.0\n')
    const s = (await computeStatuses(game, cat, DEFAULT_SETTINGS, state())).find((x) => x.productId === 'places-audio-deDE')
    expect(s?.state).toBe('update-available')
  })
})

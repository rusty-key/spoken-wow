// Places and Readables packs were released as zones-audio* / SpokenZonesAudio* and
// books-audio* / SpokenBooksAudio* before their sections were renamed. Those releases, folders
// and saved records are still the products'.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCatalog, latestFor } from '../src/main/catalog'
import type { GithubRelease } from '../src/main/github'
import { staleFolders } from '../src/main/install'
import { sanitizeState } from '../src/main/state'
import { currentProductId, productById } from '../src/shared/products'
import { makeGame, tmpDir, write } from './helpers'

function rel(tag: string, assetName: string): GithubRelease {
  return {
    tag_name: tag,
    name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-10-01T00:00:00Z',
    body: '',
    html_url: `https://github.com/rusty-key/spoken-wow/releases/tag/${tag}`,
    assets: [{ name: assetName, size: 1000, browser_download_url: `https://example/${assetName}` }]
  } as GithubRelease
}

describe('a pack released under its old name', () => {
  it('is a release of the renamed product, with its own zip', () => {
    const catalog = buildCatalog(
      [rel('zones-audio-deDE/v2.0.0', 'SpokenZonesAudio_deDE-2.0.0.zip'), rel('books-audio/v1.4.0', 'SpokenBooksAudio-1.4.0.zip')],
      { fetchedAt: null }
    )
    expect(latestFor(catalog, 'places-audio-deDE', false)).toMatchObject({ version: '2.0.0', assetName: 'SpokenZonesAudio_deDE-2.0.0.zip' })
    expect(latestFor(catalog, 'readables-audio', false)?.version).toBe('1.4.0')
    expect(catalog.releases['zones-audio-deDE']).toBeUndefined()
  })

  it('gives way to a newer release under the new name', () => {
    const catalog = buildCatalog(
      [rel('zones-audio/v2.0.0', 'SpokenZonesAudio-2.0.0.zip'), rel('places-audio/v2.1.0', 'SpokenPlacesAudio-2.1.0.zip')],
      { fetchedAt: null }
    )
    expect(latestFor(catalog, 'places-audio', false)).toMatchObject({ version: '2.1.0', assetName: 'SpokenPlacesAudio-2.1.0.zip' })
  })

  it('does not take the old zip for a release under the new name', () => {
    const catalog = buildCatalog([rel('places-audio/v2.1.0', 'SpokenZonesAudio-2.1.0.zip')], { fetchedAt: null })
    expect(latestFor(catalog, 'places-audio', false)).toBeUndefined()
  })
})

describe('a record saved under the old product id', () => {
  it('is the renamed product\'s', () => {
    expect(currentProductId('zones-audio-frFR')).toBe('places-audio-frFR')
    expect(currentProductId('quests-audio')).toBe('quests-audio')
    const state = sanitizeState({
      installs: { g: { 'zones-audio': { version: '2.0.0', folders: ['SpokenZonesAudio'] }, 'books-audio-deDE': { version: '1.0.0', folders: [] } } }
    })
    expect(Object.keys(state.installs.g!).sort()).toEqual(['places-audio', 'readables-audio-deDE'])
    expect(state.installs.g!['places-audio']!.folders).toEqual(['SpokenZonesAudio'])
  })

  it('gives way to one under the new id', () => {
    const state = sanitizeState({
      installs: { g: { 'places-audio': { version: '2.1.0', folders: ['SpokenPlacesAudio'] }, 'zones-audio': { version: '2.0.0', folders: ['SpokenZonesAudio'] } } }
    })
    expect(state.installs.g!['places-audio']!.version).toBe('2.1.0')
  })
})

describe('installing the renamed pack', () => {
  it('moves the old folder out, though the manager never recorded it', async () => {
    const base = tmpDir()
    const game = await makeGame(base)
    write(path.join(game.addOnsPath, 'SpokenZonesAudio_deDE', 'SpokenZonesAudio_deDE.toc'), '## Version: 2.0.0\n')
    const dataPath = path.join(base, 'data')
    fs.mkdirSync(dataPath)
    const product = productById('places-audio-deDE')!
    expect(await staleFolders(game, product, dataPath, ['SpokenPlacesAudio_deDE'])).toEqual(['SpokenZonesAudio_deDE'])
    // Installing an old release, whose zip holds the old folder, keeps it.
    expect(await staleFolders(game, product, dataPath, ['SpokenZonesAudio_deDE'])).toEqual([])
  })
})

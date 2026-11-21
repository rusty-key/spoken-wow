import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Catalog, type GameInstall, type ReleaseInfo, type Settings } from '../src/shared/types'
import { PRODUCTS } from '../src/shared/products'
import { emptyCatalog } from '../src/main/catalog'
import { setRecord, type StateFile } from '../src/main/state'
import { computeStatuses, parseTocVersion } from '../src/main/status'
import { makeGame, tmpDir, toc, write } from './helpers'

function rel(productId: string, version: string, prerelease = false): ReleaseInfo {
  return {
    productId,
    tag: `${productId}/v${version}`,
    version,
    prerelease,
    publishedAt: '2026-10-01T00:00:00Z',
    notes: '',
    assetName: `${productId}-${version}.zip`,
    assetSize: 1,
    assetUrl: 'https://example/x.zip',
    htmlUrl: ''
  }
}

function catalogOf(releases: Record<string, ReleaseInfo[]>): Catalog {
  return { ...emptyCatalog(), releases }
}

const state = (): StateFile => ({ version: 1, manualGames: [], hiddenGames: [], installs: {} })
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch })

async function statusOf(game: GameInstall, catalog: Catalog, productId: string, s: Settings = settings(), st: StateFile = state()) {
  const all = await computeStatuses(game, catalog, s, st)
  return all.find((x) => x.productId === productId)
}

describe('parseTocVersion', () => {
  it('reads the Version line however it is spaced', () => {
    expect(parseTocVersion('## Interface: 1\n## Version: 3.5.0\n')).toBe('3.5.0')
    expect(parseTocVersion('﻿## Title: x\r\n##Version:3.5.0-alpha.1\r\nfile.lua')).toBe('3.5.0-alpha.1')
    expect(parseTocVersion('## Title: x\n# Version: 1\n')).toBeUndefined()
    expect(parseTocVersion('## Version:\n')).toBeUndefined()
  })
})

describe('computeStatuses', () => {
  it('lists only products with a release or installed folders', async () => {
    const game = await makeGame(tmpDir())
    const all = await computeStatuses(game, catalogOf({ spoken: [rel('spoken', '3.5.0')] }), settings(), state())
    expect(all.map((s) => s.productId)).toEqual(['spoken'])
    expect(all[0]).toMatchObject({ gameId: game.id, state: 'not-installed', installedFolders: [] })
    expect(all[0]!.latest!.version).toBe('3.5.0')
    expect(all[0]!.installedVersion).toBeUndefined()
    expect(all[0]!.blockedReason).toBeUndefined()

    write(path.join(game.addOnsPath, 'SpokenPlacesAudio', 'SpokenPlacesAudio.toc'), toc('x', '1.0.0'))
    const again = await computeStatuses(game, catalogOf({ spoken: [rel('spoken', '3.5.0')] }), settings(), state())
    expect(again.map((s) => s.productId).sort()).toEqual(['places-audio', 'spoken'])
    expect(again.find((s) => s.productId === 'places-audio')).toMatchObject({ state: 'unknown', installedVersion: '1.0.0' })
  })

  const versions: [string, string, string][] = [
    ['3.4.0', '3.5.0', 'update-available'],
    ['3.5.0', '3.5.0', 'up-to-date'],
    ['3.6.0', '3.5.0', 'ahead'],
    ['3.5.0-alpha.1', '3.5.0', 'update-available'],
    ['3.10.0', '3.9.0', 'ahead']
  ]
  for (const [installed, latest, expected] of versions) {
    it(`${installed} against ${latest} is ${expected}`, async () => {
      const game = await makeGame(tmpDir())
      write(path.join(game.addOnsPath, 'Spoken', 'Spoken.toc'), toc('Spoken', installed))
      const s = await statusOf(game, catalogOf({ spoken: [rel('spoken', latest)] }), 'spoken')
      expect(s).toMatchObject({ state: expected, installedVersion: installed, installedFolders: ['Spoken'] })
    })
  }

  it('lists the Spoken folders that exist, in the product order', async () => {
    const game = await makeGame(tmpDir())
    for (const f of ['Spoken_Places', 'Spoken', 'SpokenContributions']) write(path.join(game.addOnsPath, f, `${f}.toc`), toc(f, '3.5.0'))
    write(path.join(game.addOnsPath, 'OtherAddon', 'OtherAddon.toc'), toc('o', '1'))
    const s = await statusOf(game, catalogOf({ spoken: [rel('spoken', '3.5.0')] }), 'spoken')
    expect(s!.installedFolders).toEqual(['Spoken', 'Spoken_Places', 'SpokenContributions'])
    expect(s!.state).toBe('up-to-date')
  })

  it('does not offer a pre-release unless allowed (so a newer installed one is ahead)', async () => {
    const game = await makeGame(tmpDir())
    write(path.join(game.addOnsPath, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.6.0-beta.1'))
    const cat = catalogOf({ spoken: [rel('spoken', '3.6.0-beta.1', true), rel('spoken', '3.5.0')] })
    expect(await statusOf(game, cat, 'spoken')).toMatchObject({ state: 'ahead', latest: { version: '3.5.0' } })
    expect(await statusOf(game, cat, 'spoken', settings({ includePrereleases: true }))).toMatchObject({
      state: 'up-to-date',
      latest: { version: '3.6.0-beta.1' }
    })
  })

  it('is unknown when installed but no release is known, or the version cannot be compared', async () => {
    const game = await makeGame(tmpDir())
    write(path.join(game.addOnsPath, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.5.0'))
    expect(await statusOf(game, emptyCatalog(), 'spoken')).toMatchObject({ state: 'unknown', installedVersion: '3.5.0' })

    write(path.join(game.addOnsPath, 'Spoken', 'Spoken.toc'), '## Title: Spoken\n## Version: @project-version@\n')
    const s = await statusOf(game, catalogOf({ spoken: [rel('spoken', '3.5.0')] }), 'spoken')
    expect(s).toMatchObject({ state: 'unknown' })
    expect(s!.installedVersion).toBeUndefined()
  })

  it('falls back to the manager record when the toc has no usable version', async () => {
    const game = await makeGame(tmpDir())
    write(path.join(game.addOnsPath, 'SpokenPlacesAudio', 'SpokenPlacesAudio.toc'), '## Title: x\n')
    const st = state()
    setRecord(st, game.id, 'places-audio', { version: '1.0.0', folders: ['SpokenPlacesAudio'], installedAt: '', tag: 'places-audio/v1.0.0' })
    const s = await statusOf(game, catalogOf({ 'places-audio': [rel('places-audio', '1.1.0')] }), 'places-audio', settings(), st)
    expect(s).toMatchObject({ state: 'update-available', installedVersion: '1.0.0' })
  })

  it('is linked, with the reason, when a folder is a junction', async () => {
    const game = await makeGame(tmpDir())
    const checkout = tmpDir()
    write(path.join(checkout, 'Spoken.toc'), toc('Spoken', '9.0.0-dev'))
    fs.symlinkSync(checkout, path.join(game.addOnsPath, 'Spoken'), 'junction')
    const s = await statusOf(game, catalogOf({ spoken: [rel('spoken', '3.5.0')] }), 'spoken')
    expect(s).toMatchObject({
      state: 'linked',
      installedFolders: ['Spoken'],
      blockedReason: 'This folder is linked to a development checkout. The manager will not change it.'
    })
  })

  it('is linked when only one of several folders is linked', async () => {
    const game = await makeGame(tmpDir())
    write(path.join(game.addOnsPath, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.5.0'))
    const checkout = tmpDir()
    fs.symlinkSync(checkout, path.join(game.addOnsPath, 'Spoken_Places'), 'junction')
    const s = await statusOf(game, catalogOf({ spoken: [rel('spoken', '3.5.0')] }), 'spoken')
    expect(s!.state).toBe('linked')
  })

  it('is unknown, listing what exists, when only some of a bundle folders are there', async () => {
    const game = await makeGame(tmpDir())
    const bundle = PRODUCTS.find((p) => p.id === 'quests-audio')!
    const cat = catalogOf({ 'quests-audio': [rel('quests-audio', '2.4.0')] })
    for (const f of bundle.folders!.slice(0, 2)) write(path.join(game.addOnsPath, f, `${f}.toc`), toc(f, '2.4.0'))
    const partial = await statusOf(game, cat, 'quests-audio')
    expect(partial).toMatchObject({ state: 'unknown', installedFolders: bundle.folders!.slice(0, 2) })
    for (const f of bundle.folders!.slice(2)) write(path.join(game.addOnsPath, f, `${f}.toc`), toc(f, '2.4.0'))
    expect(await statusOf(game, cat, 'quests-audio')).toMatchObject({ state: 'up-to-date', installedFolders: bundle.folders })
  })

  it('reports a game folder that is not writable', async () => {
    const game = { ...(await makeGame(tmpDir())), writable: false }
    const s = await statusOf(game, catalogOf({ spoken: [rel('spoken', '3.5.0')] }), 'spoken')
    expect(s!.blockedReason).toMatch(/cannot write/)
  })

  it('covers every product in the table when releases exist for all', async () => {
    const game = await makeGame(tmpDir())
    const releases = Object.fromEntries(PRODUCTS.map((p) => [p.id, [rel(p.id, '1.0.0')]]))
    const all = await computeStatuses(game, catalogOf(releases), settings(), state())
    expect(all).toHaveLength(PRODUCTS.length)
  })
})

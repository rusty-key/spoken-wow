import { describe, expect, it } from 'vitest'
import {
  cfPublicVersions,
  deriveRow,
  ghHasAsset,
  versionOfFileName
} from '../src/main/contributor-status'
import type { UploadRecord } from '../src/main/contributor-store'
import { languageFolders } from '../src/shared/products'

const json = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('languageFolders', () => {
  it('suffixes every folder but English and leaves out the frozen quests folder', () => {
    const pt = languageFolders('ptBR')
    expect(pt).toHaveLength(7)
    expect(pt.every((f) => f.endsWith('_ptBR'))).toBe(true)
    expect(pt).not.toContain('SpokenQuestsAudio_ptBR')
    const en = languageFolders('enUS')
    expect(en).toHaveLength(7)
    expect(en.every((f) => !f.includes('_'))).toBe(true)
    expect(en).not.toContain('SpokenQuestsAudio')
  })
})

describe('versionOfFileName', () => {
  it('takes the trailing version and ignores the folder name', () => {
    expect(versionOfFileName('SpokenZonesAudio_ruRU-2.0.0.zip')).toBe('2.0.0')
    expect(versionOfFileName('A-B-1.2.3-beta.1.zip')).toBe('1.2.3-beta.1')
    expect(versionOfFileName('nope.zip')).toBeNull()
  })
})

describe('cfPublicVersions', () => {
  it('reads the versions from files[].name', async () => {
    const f = json(200, { files: [{ name: 'X-1.0.0.zip' }, { name: 'Y-2.0.0.zip' }, { name: 'odd.zip' }] })
    expect(await cfPublicVersions('1', f)).toEqual(['1.0.0', '2.0.0'])
  })
  it('reads a 404 as a project with nothing public yet', async () => {
    expect(await cfPublicVersions('1', json(404, {}))).toEqual([])
  })

  it('answers null when it cannot tell', async () => {
    expect(await cfPublicVersions('1', json(202, {}))).toBeNull()
    expect(await cfPublicVersions('1', json(500, {}))).toBeNull()
    expect(await cfPublicVersions('1', json(200, { nope: 1 }))).toBeNull()
    const thrown = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await cfPublicVersions('1', thrown)).toBeNull()
  })
})

describe('ghHasAsset', () => {
  const asset = { assets: [{ name: 'F-1.0.0.zip', state: 'uploaded' }] }
  it('is live only when the tag holds the asset', async () => {
    const r = await ghHasAsset('o/r', 't', 'F', '1.0.0', json(200, asset))
    expect(r).toEqual({ live: true, link: 'https://github.com/o/r/releases/tag/F/v1.0.0' })
    expect((await ghHasAsset('o/r', 't', 'F', '1.0.0', json(200, { assets: [] })))?.live).toBe(false)
    expect((await ghHasAsset('o/r', 't', 'F', '1.0.0', json(404, {})))?.live).toBe(false)
    expect(await ghHasAsset('o/r', 't', 'F', '1.0.0', json(500, {}))).toBeNull()
  })
  it('does not count an asset cut short as live', async () => {
    for (const state of ['starter', 'open', undefined]) {
      expect((await ghHasAsset('o/r', 't', 'F', '1.0.0', json(200, { assets: [{ name: 'F-1.0.0.zip', state }] })))?.live).toBe(false)
    }
  })
  it('asks for the tag with its raw slash, as an upload does, with the token', async () => {
    let url = ''
    let auth = ''
    const f = (async (u: string, init: RequestInit) => {
      url = u
      auth = (init.headers as Record<string, string>).Authorization!
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    await ghHasAsset('o/r', 'tok', 'F', '1.0.0', f)
    expect(url).toBe('https://api.github.com/repos/o/r/releases/tags/F/v1.0.0')
    expect(auth).toBe('Bearer tok')
  })
})

describe('deriveRow', () => {
  const rec = (version: string): UploadRecord => ({
    store: 'curseforge',
    folder: 'F',
    version,
    fileId: null,
    at: ''
  })
  const base = {
    store: 'curseforge' as const,
    folder: 'F',
    installedVersion: '1.0.0' as string | undefined,
    linked: false,
    stale: false,
    project: '9' as string | undefined,
    publicVersions: [] as string[] | null,
    uploads: [] as UploadRecord[]
  }
  it('not installed wins over everything', () => {
    expect(deriveRow({ ...base, installedVersion: undefined, linked: true, stale: true })).toBe('not-installed')
  })
  it('linked, then stale', () => {
    expect(deriveRow({ ...base, linked: true, stale: true })).toBe('linked')
    expect(deriveRow({ ...base, stale: true })).toBe('update-first')
  })
  it('CF without a project', () => {
    expect(deriveRow({ ...base, project: undefined })).toBe('no-project')
  })
  it('live when public holds the version or a newer one', () => {
    expect(deriveRow({ ...base, publicVersions: ['1.0.0'] })).toBe('live')
    expect(deriveRow({ ...base, publicVersions: ['1.1.0'] })).toBe('live')
  })
  it('awaiting when recorded and not public', () => {
    expect(deriveRow({ ...base, uploads: [rec('1.0.0')] })).toBe('awaiting')
    expect(deriveRow({ ...base, uploads: [rec('1.0.0')], publicVersions: null })).toBe('awaiting')
  })
  it('unreleased when neither public nor recorded', () => {
    expect(deriveRow(base)).toBe('unreleased')
  })
  it('unchecked when public cannot be read and nothing is recorded', () => {
    expect(deriveRow({ ...base, publicVersions: null })).toBe('unchecked')
  })
  it('an older version recorded and public leaves a newer install unreleased', () => {
    expect(deriveRow({ ...base, installedVersion: '1.1.0', publicVersions: ['1.0.0'], uploads: [rec('1.0.0')] })).toBe(
      'unreleased'
    )
  })
})

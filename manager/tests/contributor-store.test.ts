import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlainError } from '../src/main/errors'
import { ContributorStore, type SecretBox } from '../src/main/contributor-store'
import { storeConfigured } from '../src/shared/types'
import { tmpDir } from './helpers'

function fakeBox(available = true): SecretBox {
  return {
    available: () => available,
    seal: (s) => `sealed:${Buffer.from(s).toString('base64')}`,
    open: (s) => {
      if (!s.startsWith('sealed:')) throw new Error('bad')
      return Buffer.from(s.slice(7), 'base64').toString()
    }
  }
}

function allText(dir: string): string {
  return fs
    .readdirSync(dir)
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n')
}

describe('ContributorStore', () => {
  it('tokens are trimmed and written only sealed', () => {
    const dir = tmpDir()
    const s = new ContributorStore(dir, fakeBox())
    s.setToken('curseforge', ' abc\n')
    expect(s.token('curseforge')).toBe('abc')
    expect(allText(dir)).not.toContain('abc')
    expect(s.config().hasCfToken).toBe(true)
    expect(JSON.stringify(s.config())).not.toContain('abc')
    expect(new ContributorStore(dir, fakeBox()).token('curseforge')).toBe('abc')
  })

  it('an unavailable box refuses a token and a cookie with a PlainError and writes nothing', () => {
    const dir = tmpDir()
    const s = new ContributorStore(dir, fakeBox(false))
    expect(() => s.setToken('github', 'secret')).toThrow(PlainError)
    expect(() => s.setCookie('session=secret')).toThrow(PlainError)
    expect(fs.readdirSync(dir)).toEqual([])
    expect(s.token('github')).toBeNull()
    expect(s.cookie()).toBeNull()
  })

  it('stores and clears the cookie sealed', () => {
    const dir = tmpDir()
    const s = new ContributorStore(dir, fakeBox())
    s.setCookie('session=zzz')
    expect(s.cookie()).toBe('session=zzz')
    expect(allText(dir)).not.toContain('zzz')
    s.setCookie(null)
    expect(s.cookie()).toBeNull()
  })

  it('a project id that is not all digits is refused', () => {
    const dir = tmpDir()
    const s = new ContributorStore(dir, fakeBox())
    for (const bad of ['https://x/1', 'abc']) {
      expect(() => s.saveConfig({ projects: { enUS: bad } })).toThrow(PlainError)
    }
    expect(s.config().projects).toEqual({})
    s.saveConfig({ projects: { enUS: '123', deDE: '456' } })
    expect(s.saveConfig({ projects: { enUS: '' } }).projects).toEqual({ deDE: '456' })
  })

  it('one project id on two folders is refused, naming both, and nothing is saved', () => {
    const s = new ContributorStore(tmpDir(), fakeBox())
    s.saveConfig({ projects: { A_deDE: '1', B_deDE: '2' }, repo: 'me/packs' })
    const err = (() => {
      try {
        s.saveConfig({ projects: { C_frFR: '1' }, repo: 'me/other', gameVersions: '9.9' })
        return null
      } catch (e) {
        return e as Error
      }
    })()
    expect(err).toBeInstanceOf(PlainError)
    expect(err!.message).toContain('A_deDE')
    expect(err!.message).toContain('C_frFR')
    expect(s.config()).toMatchObject({ projects: { A_deDE: '1', B_deDE: '2' }, repo: 'me/packs' })
    expect(s.config().gameVersions).not.toBe('9.9')
    expect(() => s.saveConfig({ projects: { C_frFR: '3', D_frFR: ' 3 ' } })).toThrow(PlainError)
  })

  it('a project id can move in one save, since the check reads the map as it ends up', () => {
    const s = new ContributorStore(tmpDir(), fakeBox())
    s.saveConfig({ projects: { A: '1', B: '2' } })
    expect(s.saveConfig({ projects: { A: '2', B: '1' } }).projects).toEqual({ A: '2', B: '1' })
    expect(s.saveConfig({ projects: { A: '', B: '2' } }).projects).toEqual({ B: '2' })
    expect(s.saveConfig({ projects: { C: '1' } }).projects).toEqual({ B: '2', C: '1' })
  })

  it('a repo not shaped owner/repo is refused', () => {
    const s = new ContributorStore(tmpDir(), fakeBox())
    for (const bad of ['nope', 'a/b/c', 'https://github.com/a/b', 'a/ b']) {
      expect(() => s.saveConfig({ repo: bad })).toThrow(PlainError)
    }
    expect(s.saveConfig({ repo: 'me/packs' }).repo).toBe('me/packs')
    expect(s.saveConfig({ repo: '' }).repo).toBe('')
  })

  it('has the default game versions and saves new ones', () => {
    const s = new ContributorStore(tmpDir(), fakeBox())
    expect(s.config().gameVersions).toBe('1.15.9 2.5.6 1.60.1')
    expect(s.saveConfig({ gameVersions: '1.0 2.0' }).gameVersions).toBe('1.0 2.0')
  })

  it('storeConfigured needs a token and one project id for CF, a token and a repo for GH', () => {
    const base = { projects: {}, repo: '', gameVersions: '', hasCfToken: false, hasGhToken: false }
    expect(storeConfigured('curseforge', { ...base, hasCfToken: true })).toBe(false)
    expect(storeConfigured('curseforge', { ...base, projects: { enUS: '1' } })).toBe(false)
    expect(storeConfigured('curseforge', { ...base, hasCfToken: true, projects: { enUS: '1' } })).toBe(true)
    expect(storeConfigured('github', { ...base, hasGhToken: true })).toBe(false)
    expect(storeConfigured('github', { ...base, repo: 'a/b' })).toBe(false)
    expect(storeConfigured('github', { ...base, hasGhToken: true, repo: 'a/b' })).toBe(true)
  })

  it('recordUpload keeps every record, newest last, across a new instance', () => {
    const dir = tmpDir()
    const s = new ContributorStore(dir, fakeBox())
    const a = { store: 'github' as const, folder: 'F', version: '1', fileId: null, at: 't1' }
    const b = { ...a, version: '2', at: 't2' }
    const c = { ...a, store: 'curseforge' as const, fileId: '9' }
    s.recordUpload(a)
    s.recordUpload(c)
    s.recordUpload(b)
    const again = new ContributorStore(dir, fakeBox())
    expect(again.uploads('github')).toEqual([a, b])
    expect(again.uploads('curseforge')).toEqual([c])
  })

  it('a corrupt sealed value reads as no token rather than throwing', () => {
    const dir = tmpDir()
    new ContributorStore(dir, fakeBox()).setToken('github', 'tok')
    const file = path.join(dir, 'contributor.json')
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    j.tokens.github = 'garbage'
    j.cookie = 'garbage'
    fs.writeFileSync(file, JSON.stringify(j))
    const s = new ContributorStore(dir, fakeBox())
    expect(s.token('github')).toBeNull()
    expect(s.cookie()).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import type { ContributorConfig, ContributorView, JobProgress, ReleaseRow } from '../src/shared/types'
import { isAllowedExternalUrl } from '../src/main/external'
import { ContributorStore } from '../src/main/contributor-store'
import { liveRunText, publishJobFor, releasableCount, releaseAvailable, resultLines, rowHint, rowUploadLabel, runPercent, skipReasonText, storeFormInput } from '../src/renderer/src/contributor'
import { S } from '../src/renderer/src/strings'
import { tmpDir } from './helpers'

const base: ContributorConfig = { projects: {}, repo: '', gameVersions: '', hasCfToken: false, hasGhToken: false }
const view = (account: ContributorView['account']): ContributorView => ({ account, config: base, siteUnreachable: false, sessionExpired: false, lastRuns: {} })
const admin = { email: 'a@b.c', adminLangs: ['deDE'] }

describe('releaseAvailable', () => {
  const configured = (config: ContributorConfig): ContributorView => ({ ...view(admin), config })

  it('is off when signed out, without an admin language, or before the first answer', () => {
    expect(releaseAvailable(null)).toBe(false)
    expect(releaseAvailable(view(null))).toBe(false)
    expect(releaseAvailable({ ...view({ email: 'a@b.c', adminLangs: [] }), config: { ...base, hasGhToken: true, repo: 'a/b' } })).toBe(false)
  })

  it('turns on once a store could take a pack', () => {
    expect(releaseAvailable(view(admin))).toBe(false)
    expect(releaseAvailable(configured({ ...base, hasCfToken: true }))).toBe(false)
    expect(releaseAvailable(configured({ ...base, hasGhToken: true, repo: 'a/b' }))).toBe(true)
    expect(releaseAvailable(configured({ ...base, hasCfToken: true, projects: { X: '1' } }))).toBe(true)
  })
})

describe('rowUploadLabel', () => {
  it('offers a first upload, an upload again, or nothing', () => {
    expect(rowUploadLabel({ folder: 'a', state: 'unreleased' })).toBe(S.contributor.upload)
    expect(rowUploadLabel({ folder: 'a', state: 'awaiting' })).toBe(S.contributor.uploadAgain)
    expect(rowUploadLabel({ folder: 'a', state: 'unchecked' })).toBe(S.contributor.uploadAgain)
    expect(rowUploadLabel({ folder: 'a', state: 'live' })).toBeNull()
    expect(rowUploadLabel({ folder: 'a', state: 'no-project' })).toBeNull()
  })
})

describe('releasableCount', () => {
  it('counts the unreleased rows only', () => {
    const rows: ReleaseRow[] = [
      { folder: 'a', state: 'unreleased' },
      { folder: 'b', state: 'awaiting' },
      { folder: 'c', state: 'unchecked' },
      { folder: 'd', state: 'unreleased' }
    ]
    expect(releasableCount(rows)).toBe(2)
    expect(releasableCount([])).toBe(0)
  })
})

describe('publishJobFor', () => {
  const job = (gameId: string, productId: string, action: JobProgress['action'], phase: JobProgress['phase']): JobProgress => ({
    jobId: `${gameId}${productId}`,
    gameId,
    productId,
    action,
    phase,
    received: 0,
    total: 0,
    bytesPerSecond: 0
  })

  it('finds a running publish of the store in any game, and ignores installs and the other store', () => {
    const jobs = {
      'g1|spoken': job('g1', 'spoken', 'install', 'downloading'),
      'g1|publish/github': job('g1', 'publish/github', 'publish', 'installing'),
      'g2|publish/curseforge': job('g2', 'publish/curseforge', 'publish', 'installing')
    }
    expect(publishJobFor(jobs, 'curseforge')?.gameId).toBe('g2')
    expect(publishJobFor({ 'g1|spoken': jobs['g1|spoken'] }, 'github')).toBeUndefined()
  })

  it('prefers a running job over a finished one', () => {
    const jobs = {
      'g1|publish/github': job('g1', 'publish/github', 'publish', 'done'),
      'g2|publish/github': job('g2', 'publish/github', 'publish', 'installing')
    }
    expect(publishJobFor(jobs, 'github')?.phase).toBe('installing')
  })
})

describe('storeFormInput', () => {
  const form = { token: '', removeToken: false, projects: {} as Record<string, string>, repo: ' me/packs ', versions: ' 1.0 ' }

  it('sends a cleared project id as empty and trims the rest', () => {
    expect(storeFormInput('curseforge', { ...form, projects: { A: ' 1 ', B: '', C: '   ' } })).toEqual({
      store: 'curseforge',
      projects: { A: '1', B: '', C: '' },
      gameVersions: '1.0'
    })
  })

  it('a cleared id really leaves what the store keeps', () => {
    const box = { available: () => true, seal: (s: string) => s, open: (s: string) => s }
    const store = new ContributorStore(tmpDir(), box)
    store.saveConfig({ projects: { A: '1', B: '2' } })
    const input = storeFormInput('curseforge', { ...form, projects: { A: '', B: '2' } })
    expect(store.saveConfig({ projects: input.projects! }).projects).toEqual({ B: '2' })
  })

  it('leaves the token out unless one is typed or removed, and GitHub sends only its repo', () => {
    expect(storeFormInput('github', form)).toEqual({ store: 'github', repo: 'me/packs' })
    expect(storeFormInput('github', { ...form, token: 't' })).toEqual({ store: 'github', token: 't', repo: 'me/packs' })
    expect(storeFormInput('github', { ...form, token: 't', removeToken: true })).toEqual({ store: 'github', token: '', repo: 'me/packs' })
  })

  it('takes a token of spaces as none typed, so it keeps the saved one', () => {
    expect(storeFormInput('github', { ...form, token: '   ' })).toEqual({ store: 'github', repo: 'me/packs' })
    expect(storeFormInput('github', { ...form, token: ' t ' })).toEqual({ store: 'github', token: 't', repo: 'me/packs' })
  })
})

describe('words of a release', () => {
  it('an unchecked row names its own store', () => {
    expect(rowHint('unchecked', 'github')).toContain('GitHub')
    expect(rowHint('unchecked', 'github')).not.toContain('CurseForge')
    expect(rowHint('unchecked', 'curseforge')).toContain('CurseForge')
    expect(rowHint('live', 'github')).toBe(S.contributor.hint.live)
  })

  it('each reason a pack was skipped reads differently', () => {
    const texts = (['live', 'awaiting', 'already-there'] as const).map(skipReasonText)
    expect(new Set(texts).size).toBe(3)
    expect(skipReasonText('awaiting')).toBe('Uploaded, awaiting CurseForge')
  })

  it('a skipped line keeps its reason', () => {
    const lines = resultLines({ store: 'github', lang: 'deDE', published: [], skipped: [{ folder: 'F', reason: 'already-there' }], failed: [], stoppedEarly: false })
    expect(lines).toEqual([{ kind: 'skipped', folder: 'F', reason: 'already-there' }])
  })

  it('a job with no count yet shows only the start text', () => {
    const job: JobProgress = { jobId: 'j', gameId: 'g', productId: 'publish/github', action: 'publish', phase: 'queued', received: 0, total: 0, bytesPerSecond: 0 }
    expect(liveRunText(job)).toBe(`${S.contributor.starting}…`)
    expect(liveRunText({ ...job, message: '1/3 F: zipping' })).toBe('1/3 F: zipping')
  })

  it('a step with no bytes to count has no percent', () => {
    const job: JobProgress = { jobId: 'j', gameId: 'g', productId: 'publish/github', action: 'publish', phase: 'installing', received: 0, total: 0, bytesPerSecond: 0 }
    expect(runPercent(job)).toBeNull()
    expect(runPercent({ ...job, received: 50, total: 200 })).toBe(25)
    expect(runPercent({ ...job, received: 300, total: 200 })).toBe(100)
  })
})

describe('external links of a release', () => {
  it('allows CurseForge and GitHub over https, nothing look-alike', () => {
    expect(isAllowedExternalUrl('https://www.curseforge.com/wow/addons/spoken-places')).toBe(true)
    expect(isAllowedExternalUrl('https://curseforge.com/projects/1700375')).toBe(true)
    expect(isAllowedExternalUrl('https://github.com/someone/packs/releases/tag/X/v1')).toBe(true)
    expect(isAllowedExternalUrl('http://www.curseforge.com/x')).toBe(false)
    expect(isAllowedExternalUrl('https://curseforge.com.evil.com/x')).toBe(false)
    expect(isAllowedExternalUrl('https://evilcurseforge.com/x')).toBe(false)
  })
})

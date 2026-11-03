import { describe, expect, it } from 'vitest'
import type { ContributorConfig, ContributorView, JobProgress, ReleaseRow } from '../src/shared/types'
import { isAllowedExternalUrl } from '../src/main/external'
import { publishJobFor, releasableCount, visibleTabs } from '../src/renderer/src/contributor'

const base: ContributorConfig = { projects: {}, repo: '', gameVersions: '', hasCfToken: false, hasGhToken: false }
const view = (account: ContributorView['account']): ContributorView => ({ account, config: base, canStoreSecrets: true, lastRun: null })
const admin = { email: 'a@b.c', adminLangs: ['deDE'] }

describe('visibleTabs', () => {
  it('shows nothing when signed out or without an admin language', () => {
    expect(visibleTabs(view(null), base)).toEqual([])
    expect(visibleTabs(view({ email: 'a@b.c', adminLangs: [] }), base)).toEqual([])
  })

  it('shows Stores alone until a store is configured, then Release too', () => {
    expect(visibleTabs(view(admin), base)).toEqual(['stores'])
    expect(visibleTabs(view(admin), { ...base, hasCfToken: true })).toEqual(['stores'])
    expect(visibleTabs(view(admin), { ...base, hasGhToken: true, repo: 'a/b' })).toEqual(['stores', 'release'])
    expect(visibleTabs(view(admin), { ...base, hasCfToken: true, projects: { X: '1' } })).toEqual(['stores', 'release'])
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

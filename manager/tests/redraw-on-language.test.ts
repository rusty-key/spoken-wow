import { afterEach, describe, expect, it } from 'vitest'
import { S, setUiLanguage } from '../src/renderer/src/strings'
import { S_ZH } from '../src/renderer/src/strings.zh'
import { reducer, initial } from '../src/renderer/src/store'
import { DEFAULT_SETTINGS } from '../src/shared/types'

afterEach(() => setUiLanguage('enUS'))

/**
 * The window has no React test renderer here, so this checks the link the redraw hangs on: the
 * reducer swaps `S`'s words and returns a new state object, which is what makes React draw again.
 * If this link breaks, the language setting would appear to do nothing.
 */
describe('a settings change redraws the window in the new language', () => {
  it('the reducer swaps the words, not a copy of them', () => {
    const before = S.tabs.home
    expect(before).toBe('Home')

    const next = reducer(initial, { type: 'settings', settings: { ...DEFAULT_SETTINGS, uiLanguage: 'zhCN' } })

    // The same object every component holds now says Chinese.
    expect(S.tabs.home).toBe(S_ZH.tabs.home)
    expect(S.tabs.home).not.toBe(before)
    // A new state object: React sees the change and redraws.
    expect(next.settings.uiLanguage).toBe('zhCN')
  })

  it('an unchanged language leaves the words alone', () => {
    reducer(initial, { type: 'settings', settings: { ...DEFAULT_SETTINGS, uiLanguage: 'enUS' } })
    expect(S.tabs.home).toBe('Home')
  })

  it('the first snapshot sets the language before anything is drawn in it', () => {
    const snap = {
      games: [],
      settings: { ...DEFAULT_SETTINGS, uiLanguage: 'zhCN' as const },
      catalog: { fetchedAt: null, offline: false, releases: {} },
      community: { fetchedAt: null, offline: false, packs: [] },
      products: [],
      appVersion: '0.0.0',
      platform: 'win32' as const,
      dataPath: ''
    }
    const next = reducer(initial, { type: 'init', snap, statuses: {}, page: 'home', gameId: '' })
    expect(next.ready).toBe(true)
    expect(S.tabs.home).toBe(S_ZH.tabs.home)
  })
})

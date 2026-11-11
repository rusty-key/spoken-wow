import { beforeEach, describe, expect, it } from 'vitest'
import { S, setUiLanguage, uiLanguage } from '../src/renderer/src/strings'
import { S_ZH } from '../src/renderer/src/strings.zh'

/** The switch the settings page drives, exercised the way the store drives it. */
describe('setUiLanguage', () => {
  beforeEach(() => setUiLanguage('enUS'))

  it('swaps the words behind the same S object', () => {
    const before = S.tabs.home
    expect(before).toBe('Home')
    setUiLanguage('zhCN')
    // Same object, so every importer that captured S still reads the new words.
    expect(S.tabs.home).toBe(S_ZH.tabs.home)
    expect(S.tabs.home).not.toBe(before)
    expect(uiLanguage()).toBe('zhCN')
  })

  it('keeps the functions callable, not just the plain words', () => {
    setUiLanguage('zhCN')
    expect(S.jobs.downloading(7)).toBe(S_ZH.jobs.downloading(7))
    expect(S.common.showIn('darwin')).toBe('在访达中显示')
  })

  it('goes back, and ignores a language there is no file for', () => {
    setUiLanguage('zhCN')
    setUiLanguage('enUS')
    expect(S.tabs.home).toBe('Home')
    setUiLanguage('frFR' as never)
    expect(S.tabs.home).toBe('Home')
    expect(uiLanguage()).toBe('enUS')
  })
})

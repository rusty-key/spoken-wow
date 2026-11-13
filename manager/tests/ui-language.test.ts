import { beforeEach, describe, expect, it } from 'vitest'
import { S, setUiLanguage } from '../src/renderer/src/strings'
import { S_ZH } from '../src/renderer/src/strings.zh'

/** The switch the settings page drives, exercised the way the store drives it. */
describe('setUiLanguage', () => {
  beforeEach(() => setUiLanguage('enUS'))

  it('keeps the functions callable, not just the plain words', () => {
    setUiLanguage('zhCN')
    expect(S.jobs.downloading(7)).toBe(S_ZH.jobs.downloading(7))
    expect(S.common.showIn('darwin')).toBe('在访达中显示')
  })

  it('goes back to English', () => {
    setUiLanguage('zhCN')
    setUiLanguage('enUS')
    expect(S.tabs.home).toBe('Home')
  })
})

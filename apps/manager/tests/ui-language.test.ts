import { beforeEach, describe, expect, it } from 'vitest'
import { S, setUiLanguage } from '../src/renderer/src/strings'
import { S_ZH } from '../src/renderer/src/strings.zh'
import { UI_LANGUAGES } from '../src/shared/types'

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

  it('offers one Spanish entry, named for every Spanish speaker', () => {
    expect(UI_LANGUAGES.find((l) => l.code === 'esES' && 'name' in l)?.name).toBe('Español')
    expect(UI_LANGUAGES.some((l) => (l.code as string) === 'esMX')).toBe(false)
  })
})

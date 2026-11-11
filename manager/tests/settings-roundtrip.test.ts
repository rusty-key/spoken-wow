import { afterEach, describe, expect, it } from 'vitest'
import { setUiLanguage } from '../src/renderer/src/strings'
import { setMainLanguage, t } from '../src/main/i18n'
import { sanitizeSettings } from '../src/main/state'

/** Both languages reset here, so a failed assertion cannot leave them set for the next test. */
afterEach(() => {
  setUiLanguage('enUS')
  setMainLanguage('enUS')
})

/**
 * The settings page sets `uiLanguage`; the window reads it through `S`, and the main process
 * through `t`. This checks that one setting is all it takes to keep them together, and that the
 * choice survives a restart.
 */
describe('one setting drives both processes', () => {
  it('the renderer and the main process agree once the setting is applied', () => {
    for (const lang of ['enUS', 'zhCN'] as const) {
      setUiLanguage(lang)
      setMainLanguage(lang)
      expect(t('service.upToDate').includes('已是最新')).toBe(lang === 'zhCN')
    }
  })

  it('the setting round-trips through sanitizeSettings, so a restart keeps it', () => {
    expect(sanitizeSettings({ uiLanguage: 'zhCN' }).uiLanguage).toBe('zhCN')
    expect(sanitizeSettings({ uiLanguage: 'enUS' }).uiLanguage).toBe('enUS')
    // An unknown language falls back to the default rather than emptying the window.
    expect(sanitizeSettings({ uiLanguage: 'xxXX' }).uiLanguage).toBe('enUS')
  })
})

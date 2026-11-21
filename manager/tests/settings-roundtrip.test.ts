import { describe, expect, it } from 'vitest'
import { sanitizeSettings } from '../src/main/state'

describe('the window language setting', () => {
  it('round-trips through sanitizeSettings, so a restart keeps it', () => {
    expect(sanitizeSettings({ uiLanguage: 'zhCN' }).uiLanguage).toBe('zhCN')
    expect(sanitizeSettings({ uiLanguage: 'enUS' }).uiLanguage).toBe('enUS')
    // An unknown language falls back to the default rather than emptying the window.
    expect(sanitizeSettings({ uiLanguage: 'xxXX' }).uiLanguage).toBe('enUS')
  })
})

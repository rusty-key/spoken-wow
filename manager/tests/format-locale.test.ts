import { describe, expect, it } from 'vitest'
import { formatDate, formatTime, pluralForm } from '../src/renderer/src/format'
import { setUiLanguage } from '../src/renderer/src/strings'
import { localeTag } from '../src/renderer/src/locale'
import { S } from '../src/renderer/src/strings'
import { S_ZH } from '../src/renderer/src/strings.zh'

const ISO = '2026-11-12T09:30:00.000Z'

describe('dates follow the window language, not the system', () => {
  it('asks Intl for a tag it knows, since the game codes are not tags', () => {
    setUiLanguage('enUS')
    expect(localeTag()).toBe('en-US')
    setUiLanguage('zhCN')
    // `zhCN` alone would make toLocaleDateString fall back to the machine's language.
    expect(localeTag()).toBe('zh-CN')
  })

  it('writes the date in the chosen language', () => {
    setUiLanguage('enUS')
    const en = formatDate(ISO)
    setUiLanguage('zhCN')
    const zh = formatDate(ISO)
    expect(en).not.toBe(zh)
    // Chinese dates carry 年/月/日; an English one carries a month name.
    expect(zh).toMatch(/年|月/)
  })

  it('reads the clock the same way, and still returns nothing for nothing', () => {
    setUiLanguage('zhCN')
    expect(formatTime(ISO)).toMatch(/\d/)
    expect(formatDate(null)).toBe('')
    expect(formatDate('not a date')).toBe('')
    expect(formatTime(undefined)).toBe('')
  })
})

describe('counted words use the language s plural rule', () => {
  it('picks the form Intl names, not a hand-written n === 1', () => {
    setUiLanguage('enUS')
    const forms = { one: 'pack', other: 'packs' }
    expect(pluralForm(0, forms)).toBe('packs')
    expect(pluralForm(1, forms)).toBe('pack')
    expect(pluralForm(2, forms)).toBe('packs')
    // Intl says 1.5 is "other" in English; `n === 1` would have said "one".
    expect(pluralForm(1.5, forms)).toBe('packs')
  })

  it('falls back to other when a form the language wants is missing', () => {
    setUiLanguage('zhCN')
    // Chinese selects "other" for every count; a lone `one` must not crash the window.
    expect(pluralForm(1, { other: '包' })).toBe('包')
    expect(pluralForm(2, { other: '包' })).toBe('包')
  })

  it('draws the real counted sentences in both languages', () => {
    setUiLanguage('enUS')
    expect(S.home.voicePacks(1)).toBe('1 Voice Pack')
    expect(S.home.voicePacks(3)).toBe('3 Voice Packs')
    setUiLanguage('zhCN')
    expect(S.home.voicePacks(1)).toBe(S_ZH.home.voicePacks(1))
    expect(S.home.voicePacks(3)).toBe('3 个语音包')
  })
})

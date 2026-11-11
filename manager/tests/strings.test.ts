import { describe, expect, it } from 'vitest'
import { S_EN } from '../src/renderer/src/strings.en'
import { S_ZH } from '../src/renderer/src/strings.zh'
import { DEFAULT_SETTINGS, SETTING_CHOICES, UI_LANGUAGE_CODES, UI_LANGUAGES } from '../src/shared/types'

/** Every leaf of a dictionary: `settings.folders`, `jobs.downloading`, `modules.0.title`. */
function leaves(value: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>()
  if (Array.isArray(value)) {
    value.forEach((v, i) => leaves(v, `${prefix}.${i}`).forEach((leaf, k) => out.set(k, leaf)))
    return out
  }
  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) leaves(v, prefix ? `${prefix}.${k}` : k).forEach((leaf, path) => out.set(path, leaf))
    return out
  }
  out.set(prefix, value)
  return out
}

describe('the window language', () => {
  it('every language file has exactly the keys English has', () => {
    expect([...leaves(S_ZH).keys()].sort()).toEqual([...leaves(S_EN).keys()].sort())
  })

  it('a key holds the same kind of thing in every language', () => {
    // A word translated as a function (or not) would be read wrong the moment the window draws it.
    const en = leaves(S_EN)
    for (const [path, value] of leaves(S_ZH)) {
      expect(typeof value, path).toBe(typeof en.get(path))
    }
  })

  it('no string is left empty', () => {
    for (const [path, value] of [...leaves(S_EN), ...leaves(S_ZH)]) {
      if (typeof value === 'string') expect(value.trim(), path).not.toBe('')
    }
  })

  it('the language list, the default and the stored choice agree', () => {
    expect(UI_LANGUAGE_CODES).toEqual(UI_LANGUAGES.map((l) => l.code))
    expect(UI_LANGUAGE_CODES).toContain(DEFAULT_SETTINGS.uiLanguage)
    expect(SETTING_CHOICES.uiLanguage).toEqual(UI_LANGUAGE_CODES)
  })
})

import { describe, expect, it } from 'vitest'
import { S_EN } from '../src/renderer/src/strings.en'
import { DICTS } from '../src/renderer/src/strings'

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

const TRANSLATIONS = Object.entries(DICTS).filter(([language]) => language !== 'enUS')

describe('the window language', () => {
  it('no string is left empty', () => {
    for (const [language, dict] of Object.entries(DICTS)) {
      for (const [path, value] of leaves(dict)) {
        if (typeof value === 'string') expect(value.trim(), `${language}.${path}`).not.toBe('')
      }
    }
  })

  // A translation without a module's folder name crashes the Spoken page.
  it('every translation has every field English has', () => {
    const english = [...leaves(S_EN).keys()]
    for (const [language, dict] of TRANSLATIONS) {
      const have = leaves(dict)
      expect(english.filter((path) => !have.has(path)), language).toEqual([])
    }
  })
})

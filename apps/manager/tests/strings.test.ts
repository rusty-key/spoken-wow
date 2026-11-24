import { describe, expect, it } from 'vitest'
import { S_EN } from '../src/renderer/src/strings.en'
import { S_DE } from '../src/renderer/src/strings.de'
import { S_ES } from '../src/renderer/src/strings.es'
import { S_FR } from '../src/renderer/src/strings.fr'
import { S_KO } from '../src/renderer/src/strings.ko'
import { S_PT } from '../src/renderer/src/strings.pt'
import { S_RU } from '../src/renderer/src/strings.ru'
import { S_ZH } from '../src/renderer/src/strings.zh'
import { S_ZH_TW } from '../src/renderer/src/strings.zh-tw'

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
  it('no string is left empty', () => {
    for (const [language, dict] of Object.entries({ enUS: S_EN, deDE: S_DE, esES: S_ES, frFR: S_FR, koKR: S_KO, ptBR: S_PT, ruRU: S_RU, zhCN: S_ZH, zhTW: S_ZH_TW })) {
      for (const [path, value] of leaves(dict)) {
        if (typeof value === 'string') expect(value.trim(), `${language}.${path}`).not.toBe('')
      }
    }
  })
})

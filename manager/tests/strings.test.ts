import { describe, expect, it } from 'vitest'
import { S_EN } from '../src/renderer/src/strings.en'
import { S_ZH } from '../src/renderer/src/strings.zh'

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
    for (const [path, value] of [...leaves(S_EN), ...leaves(S_ZH)]) {
      if (typeof value === 'string') expect(value.trim(), path).not.toBe('')
    }
  })
})

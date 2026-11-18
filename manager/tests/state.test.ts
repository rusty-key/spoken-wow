import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {}, ipcMain: { handle: () => undefined } }))

import { settingsPatch } from '../src/main/ipc'
import { sanitizeSettings } from '../src/main/state'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const BAD: unknown[] = [null, 7, 'deDE', ['stimmen'], { deDE: 3 }, { deDE: 'Stimmen!' }, { deDE: { slug: 'stimmen' } }, { xx: 'all' }]

describe('the Author choice per language', () => {
  it('keeps a team slug or All for each language', () => {
    expect(sanitizeSettings({ voiceAuthors: { deDE: 'stimmen', jaJP: 'all' } }).voiceAuthors).toEqual({ deDE: 'stimmen', jaJP: 'all' })
    expect(DEFAULT_SETTINGS.voiceAuthors).toEqual({})
  })

  it('drops what is neither, and every key that is not a language', () => {
    for (const v of BAD) expect(sanitizeSettings({ voiceAuthors: v }).voiceAuthors, JSON.stringify(v)).toEqual({})
    expect(sanitizeSettings({ voiceAuthors: { deDE: 'stimmen', frFR: 3, xx: 'all' } }).voiceAuthors).toEqual({ deDE: 'stimmen' })
  })

  it('a saved choice outlives a bad one sent later', () => {
    const saved = sanitizeSettings({ voiceAuthors: { deDE: 'stimmen' } })
    expect(sanitizeSettings({ voiceAuthors: null }, saved).voiceAuthors).toEqual({ deDE: 'stimmen' })
  })

  it('is refused from the window when any of it is bad', () => {
    expect(settingsPatch({ voiceAuthors: { deDE: 'stimmen', jaJP: 'all' } })).toEqual({ voiceAuthors: { deDE: 'stimmen', jaJP: 'all' } })
    for (const v of BAD) expect(() => settingsPatch({ voiceAuthors: v }), JSON.stringify(v)).toThrow('Invalid setting voiceAuthors')
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { settingsPatch } from '../src/main/ipc'
import { loadSettings, saveSettings } from '../src/main/state'
import { DEFAULT_SETTINGS, type Product, type ProductStatus, type Settings } from '../src/shared/types'
import { ANNOUNCEMENT_ID, showsAnnouncement } from '../src/renderer/src/announcement'
import { AnnouncementBanner } from '../src/renderer/src/components/TopBar'
import { setUiLanguage } from '../src/renderer/src/strings'

const pack = (id: string, lang: string): Product => ({ id, kind: 'voices', lang }) as Product
const PRODUCTS = [pack('quests-audio', 'enUS'), pack('quests-audio-deDE', 'deDE'), { id: 'spoken', kind: 'addon' } as Product]
const status = (productId: string, state: ProductStatus['state'] = 'up-to-date'): ProductStatus => ({ gameId: 'g1', productId, state, installedFolders: [] })
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch })

describe('the feedback announcement', () => {
  it('shows when an English voice pack is installed', () => {
    expect(showsAnnouncement(settings({ voiceLanguage: 'deDE' }), PRODUCTS, { g1: [status('quests-audio'), status('quests-audio-deDE')] })).toBe(true)
  })

  it('is hidden when only packs of other languages are installed', () => {
    const statuses = { g1: [status('spoken'), status('quests-audio-deDE'), status('quests-audio', 'not-installed')] }
    expect(showsAnnouncement(settings(), PRODUCTS, statuses)).toBe(false)
  })

  it('follows the Voice Packs language when no voice pack is installed', () => {
    const statuses = { g1: [status('spoken')] }
    expect(showsAnnouncement(settings(), PRODUCTS, statuses)).toBe(true)
    expect(showsAnnouncement(settings({ voiceLanguage: 'frFR' }), PRODUCTS, statuses)).toBe(false)
  })

  it('stays hidden once closed, and a new announcement id shows again', () => {
    const statuses = { g1: [status('quests-audio')] }
    expect(showsAnnouncement(settings({ dismissedAnnouncement: ANNOUNCEMENT_ID }), PRODUCTS, statuses)).toBe(false)
    expect(showsAnnouncement(settings({ dismissedAnnouncement: 'an-older-one' }), PRODUCTS, statuses)).toBe(true)
  })

  it('keeps the closed state across a restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'announcement-'))
    try {
      const patch = settingsPatch({ dismissedAnnouncement: ANNOUNCEMENT_ID })
      saveSettings(dir, { ...loadSettings(dir), ...patch })
      const reloaded = loadSettings(dir)
      expect(reloaded.dismissedAnnouncement).toBe(ANNOUNCEMENT_ID)
      expect(showsAnnouncement(reloaded, PRODUCTS, { g1: [status('quests-audio')] })).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('draws one line with the link and a close button', () => {
    setUiLanguage('enUS')
    const html = renderToStaticMarkup(createElement(AnnouncementBanner, { onOpen: () => undefined, onClose: () => undefined }))
    expect(html).toContain('Share feedback on upcoming voices:')
    expect(html).toContain('spoken.quest/listen')
    expect(html).toContain('aria-label="Dismiss"')
  })
})

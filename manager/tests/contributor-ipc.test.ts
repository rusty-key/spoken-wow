import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  shell: {},
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => void handlers.set(channel, fn) }
}))
const logged: unknown[][] = []
vi.mock('../src/main/state', () => ({ log: (...parts: unknown[]) => void logged.push(parts), logsDir: () => '' }))

import { CHANNELS } from '../src/shared/api'
import { contributorLang, contributorOnly, contributorStore, registerIpc } from '../src/main/ipc'
import { languageFolders } from '../src/shared/products'

describe('contributor argument checks', () => {
  it('a store other than curseforge or github is refused', () => {
    expect(contributorStore('curseforge')).toBe('curseforge')
    expect(contributorStore('github')).toBe('github')
    expect(() => contributorStore('modrinth')).toThrow('Invalid store')
    expect(() => contributorStore(undefined)).toThrow('Invalid store')
  })

  it('a language not in LANGUAGES is refused', () => {
    expect(contributorLang('deDE')).toBe('deDE')
    expect(() => contributorLang('xxXX')).toThrow('Invalid language')
    expect(() => contributorLang(7)).toThrow('Invalid language')
  })

  it('a folder passed as only must be one of languageFolders(lang)', () => {
    const [first] = languageFolders('deDE')
    expect(contributorOnly('deDE', undefined)).toBeUndefined()
    expect(contributorOnly('deDE', first)).toBe(first)
    expect(() => contributorOnly('deDE', '../escape')).toThrow('Invalid pack')
    expect(() => contributorOnly('deDE', languageFolders('frFR')[0])).toThrow('Invalid pack')
  })
})

describe('contributor IPC', () => {
  it("an IPC failure's log line holds no password", async () => {
    const secret = 'hunter2-secret-password'
    const service = {
      ready: Promise.resolve(),
      contributor: { signIn: async () => Promise.reject(new Error('The site answered HTTP 500.')) }
    }
    const indexHtml = '/app/index.html'
    registerIpc(service as never, { indexHtml }, () => ({ state: 'idle' }))
    const frame = { url: pathToFileURL(indexHtml).href }
    const event = { senderFrame: frame, sender: { mainFrame: frame } }
    await expect(handlers.get(CHANNELS.contributorSignIn)!(event, 'a@b.c', secret)).rejects.toThrow('HTTP 500')
    expect(logged.length).toBeGreaterThan(0)
    expect(JSON.stringify(logged)).not.toContain(secret)
    await expect(handlers.get(CHANNELS.contributorSignIn)!(event, 'a@b.c', 42)).rejects.toThrow('Invalid password')
    expect(JSON.stringify(logged)).not.toContain('42')
  })
})

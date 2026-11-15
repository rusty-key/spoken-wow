import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEED_URL, ManagerUpdater } from '../src/main/updater'

describe('manager update feed', () => {
  it('is the generic manager-latest release, in the code and in the electron-builder config', () => {
    expect(FEED_URL).toBe('https://github.com/rusty-key/spoken-wow/releases/download/manager-latest')
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    expect(pkg.build.publish).toEqual([{ provider: 'generic', url: FEED_URL }])
  })

  it('the production CSP header matches the meta tag of the window', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8')
    const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1]
    const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8')
    expect(code).not.toContain('avatars.githubusercontent.com')
    const header = /return \[("default-src[^\]]+)\]\.join/.exec(code)?.[1]
    const parse = (s: string): string[] => s.split(';').map((x) => x.trim()).filter(Boolean).sort()
    expect(parse(header!.replace(/",\s*"/g, '; ').replace(/^"|"$/g, '').replace(/"/g, ''))).toEqual(parse(meta!))
  })
})

describe('a check waits for the proxy', () => {
  it('does not ask electron-updater before the session proxy is in place', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const updater = new ManagerUpdater({
      isPackaged: true,
      appVersion: '0.1.0',
      autoUpdateManager: () => true,
      send: () => undefined,
      platform: 'win32',
      proxyReady: async () => {
        order.push('proxy')
        await gate
      },
      loadUpdater: async () => ({
        setFeedURL: () => order.push('feed'),
        autoDownload: true,
        autoInstallOnAppQuit: true,
        logger: null,
        on: () => undefined,
        checkForUpdates: async () => order.push('check'),
        quitAndInstall: () => undefined
      })
    })
    const done = updater.checkInBackground()
    await Promise.resolve()
    // Nothing has gone out yet: the proxy promise has not resolved.
    expect(order).toEqual(['proxy'])
    release()
    await done
    expect(order).toEqual(['proxy', 'feed', 'check'])
  })

  it('a second check started while the first waits is turned away, so the feed is read once', async () => {
    const reads: string[] = []
    const states: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const updater = new ManagerUpdater({
      isPackaged: true,
      appVersion: '0.1.0',
      // Linux outside an AppImage, the mode that reads the feed itself.
      autoUpdateManager: () => true,
      send: (state) => states.push(state.state),
      platform: 'linux',
      env: {},
      proxyReady: async () => gate,
      fetchText: async (url) => {
        reads.push(url)
        // Newer than the running version, so the check has something to publish.
        return 'version: 9.9.9'
      }
    })
    const first = updater.checkInBackground()
    const second = updater.checkInBackground()
    await Promise.resolve()
    release()
    await Promise.all([first, second])
    // The state was claimed before the wait, so the second call never got as far as the feed.
    expect(reads).toHaveLength(1)
    expect(states).toEqual(['checking', 'available'])
  })
})

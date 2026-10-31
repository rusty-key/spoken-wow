// The manager's own update. The feed is a release tagged `manager-latest` whose assets
// (latest*.yml and the installers) each manager release replaces, so the repo's other releases
// (spoken/, *-audio/) never get in the way.
//
// Windows (NSIS installer), macOS (signed and notarized, updated from the zip) and a Linux AppImage
// use electron-updater's generic provider: it downloads the update and installs it when the
// manager quits. Outside an AppImage on Linux (the tar.gz, deb and rpm) the manager does not use
// electron-updater at all: it reads the feed's `latest-linux.yml`, compares the version and reports
// the page to download from. Does nothing when the app is not packaged or the player switched it
// off; it never throws.
import { compareVersions } from '../shared/version'
import type { UpdaterState } from '../shared/api'
import { log } from './state'

export const FEED_URL = 'https://github.com/rusty-key/spoken-wow/releases/download/manager-latest'

/** Where a player downloads a newer manager by hand. */
export const MANUAL_UPDATE_URL = 'https://github.com/rusty-key/spoken-wow/releases/tag/manager-latest'

export interface UpdaterOptions {
  isPackaged: boolean
  /** The running manager's version. */
  appVersion: string
  autoUpdateManager: () => boolean
  send: (state: UpdaterState) => void
  /** Default: the running platform. */
  platform?: NodeJS.Platform
  /** Default: the process environment (the AppImage runtime sets APPIMAGE). */
  env?: NodeJS.ProcessEnv
  /** The feed folder's address. Default: FEED_URL. */
  feedUrl?: string
  /** The electron-updater object, or null when there is none (tests). Default: electron-updater's `autoUpdater`. */
  loadUpdater?: () => Promise<UpdaterLike | null>
  /** Reads a text file from the web; throws when it cannot (tests). Default: `fetch` with a time limit. */
  fetchText?: (url: string) => Promise<string>
}

/** The part of electron-updater's `autoUpdater` this file uses. */
export interface UpdaterLike {
  setFeedURL(options: { provider: 'generic'; url: string }): void
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  on(event: string, listener: (arg: never) => void): unknown
  checkForUpdates(): Promise<unknown>
}

/** `auto`: electron-updater downloads and installs. `manual`: only tell the player where to get the new version. */
export function updateMode(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): 'auto' | 'manual' {
  if (platform === 'win32' || platform === 'darwin') return 'auto'
  if (platform === 'linux' && env.APPIMAGE) return 'auto'
  return 'manual'
}

/** The feed file that names the newest version for a platform. */
export function feedFileFor(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'latest-mac.yml' : platform === 'linux' ? 'latest-linux.yml' : 'latest.yml'
}

/** The `version:` of an electron-builder feed file, or null. */
export function parseFeedVersion(text: string): string | null {
  const m = /^version:[ \t]*['"]?([^'"\s]+)['"]?[ \t]*$/m.exec(text.replace(/^﻿/, ''))
  return m ? m[1]! : null
}

async function fetchWithLimit(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Spoken-Manager' } })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const text = await res.text()
  if (text.length > 256 * 1024) throw new Error(`${url}: too large`)
  return text
}

async function loadElectronUpdater(): Promise<UpdaterLike | null> {
  const mod = await import('electron-updater')
  const u = mod.autoUpdater ?? (mod as unknown as { default?: typeof mod }).default?.autoUpdater
  return (u as unknown as UpdaterLike | undefined) ?? null
}

export class ManagerUpdater {
  private updater: UpdaterLike | null = null
  private last: UpdaterState = { state: 'idle' }
  /** The check in progress was started by the player, not by the manager on its own. */
  private userTriggered = false
  private readonly platform: NodeJS.Platform
  private readonly mode: 'auto' | 'manual'

  constructor(private readonly opts: UpdaterOptions) {
    this.platform = opts.platform ?? process.platform
    this.mode = updateMode(this.platform, opts.env ?? process.env)
  }

  private publish(state: UpdaterState): void {
    this.last = state
    try {
      this.opts.send(state)
    } catch (err) {
      log('Updater state not sent:', err)
    }
  }

  /** A failed check is only shown when the player asked for it (or a download had begun); otherwise it is logged and the state goes back to idle. */
  private failed(reason: unknown): void {
    log('Manager update failed:', reason)
    if (this.userTriggered || this.last.state === 'downloading') {
      this.publish({ state: 'error', message: 'Could not check for a newer manager. Check your connection and try again.' })
    } else this.publish({ state: 'idle' })
  }

  private async load(): Promise<UpdaterLike | null> {
    if (this.updater) return this.updater
    const u = await (this.opts.loadUpdater ?? loadElectronUpdater)()
    if (!u) return null
    u.setFeedURL({ provider: 'generic', url: this.opts.feedUrl ?? FEED_URL })
    u.autoDownload = true
    u.autoInstallOnAppQuit = true
    u.logger = {
      info: (m?: unknown) => log('updater:', m),
      warn: (m?: unknown) => log('updater warn:', m),
      error: (m?: unknown) => log('updater error:', m),
      debug: () => undefined
    }
    u.on('checking-for-update', () => this.publish({ state: 'checking' }))
    u.on('update-available', (info: { version: unknown }) => this.publish({ state: 'available', version: String(info.version) }))
    u.on('update-not-available', () => this.publish({ state: 'idle' }))
    u.on('download-progress', (p: { percent: number }) => this.publish({ state: 'downloading', percent: Math.round(p.percent) }))
    u.on('update-downloaded', (info: { version: unknown }) => this.publish({ state: 'ready', version: String(info.version) }))
    u.on('error', (err: unknown) => this.failed(err))
    this.updater = u
    return u
  }

  /** Linux outside an AppImage: read the feed, compare, point to the download page. */
  private async checkManually(): Promise<void> {
    this.publish({ state: 'checking' })
    const url = `${this.opts.feedUrl ?? FEED_URL}/${feedFileFor(this.platform)}`
    const text = await (this.opts.fetchText ?? fetchWithLimit)(url)
    const version = parseFeedVersion(text)
    if (!version) throw new Error(`${url}: no version in the file`)
    const c = compareVersions(this.opts.appVersion, version)
    if (c === null) throw new Error(`${url}: "${version}" is not a version`)
    if (c < 0) this.publish({ state: 'available', version, url: MANUAL_UPDATE_URL })
    else this.publish({ state: 'idle' })
  }

  private async check(byPlayer: boolean): Promise<void> {
    this.userTriggered = byPlayer
    try {
      if (this.mode === 'manual') return await this.checkManually()
      const u = await this.load()
      if (!u) return this.failed('electron-updater has no autoUpdater')
      await u.checkForUpdates()
    } catch (err) {
      this.failed(err)
    }
  }

  /** Called once at start: checks when the player has not switched it off and the app is installed. */
  async start(): Promise<void> {
    this.publish({ state: 'idle' })
    if (!this.opts.isPackaged || !this.opts.autoUpdateManager()) return
    await this.check(false)
  }

  /** A check the player asked for: failures are reported as `error`. */
  async checkNow(): Promise<void> {
    if (!this.opts.isPackaged) {
      this.publish({ state: 'error', message: 'The manager can only update itself when it is installed.' })
      return
    }
    await this.check(true)
  }
}

let current: ManagerUpdater | null = null

export async function startUpdater(options: UpdaterOptions): Promise<void> {
  current = new ManagerUpdater(options)
  await current.start()
}

export async function checkForManagerUpdate(): Promise<void> {
  await current?.checkNow()
}

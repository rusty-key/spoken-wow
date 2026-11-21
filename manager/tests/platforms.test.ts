// What differs per operating system: where games are found, letter case in names, the window's frame,
// how the manager updates itself. Every platform's logic runs on every machine: the platform and the
// home folder are parameters, and the "root of the disk" is a temp folder.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type ReleaseInfo } from '../src/shared/types'
import type { UpdaterState } from '../src/shared/api'
import { windowChrome } from '../src/main/chrome'
import { emptyCatalog } from '../src/main/catalog'
import { describeFlavorFolder, discoverUnixPaths, findCandidatePaths, parseProductDb, resolveGamePath, scanGames } from '../src/main/games'
import { ManagerService } from '../src/main/service'
import { computeStatuses } from '../src/main/status'
import { FEED_URL, ManagerUpdater, MANUAL_UPDATE_URL, feedFileFor, parseFeedVersion, updateMode, type UpdaterLike } from '../src/main/updater'
import { makeGame, startServer, tmpDir, toc, write, type TestServer } from './helpers'

const WOW = 'World of Warcraft'

function mkdirs(...parts: string[]): string {
  const dir = path.join(...parts)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const sorted = (list: string[]): string[] => [...list].sort()

/** A text file of these lines, each ending in a line feed. */
const yml = (...lines: string[]): string => lines.join(String.fromCharCode(10)) + String.fromCharCode(10)

// ---------------------------------------------------------------- macOS

describe('finding the game on macOS', () => {
  function layout() {
    const fsRoot = tmpDir()
    const home = mkdirs(fsRoot, 'Users', 'me')
    const system = mkdirs(fsRoot, 'Applications', WOW)
    const user = mkdirs(home, 'Applications', WOW)
    const volumeA = mkdirs(fsRoot, 'Volumes', 'Games', WOW)
    const volumeB = mkdirs(fsRoot, 'Volumes', 'Disk2', 'Applications', WOW)
    mkdirs(fsRoot, 'Volumes', 'Empty')
    return { fsRoot, home, system, user, volumeA, volumeB }
  }

  it('looks in /Applications, ~/Applications and on every mounted volume', async () => {
    const l = layout()
    const found = await discoverUnixPaths({ platform: 'darwin', homedir: l.home, fsRoot: l.fsRoot })
    expect(sorted(found)).toEqual(sorted([l.system, l.user, l.volumeA, l.volumeB]))
  })

  it('lists only folders that exist, and nothing when there are none', async () => {
    const fsRoot = tmpDir()
    expect(await discoverUnixPaths({ platform: 'darwin', homedir: path.join(fsRoot, 'home'), fsRoot })).toEqual([])
  })

  it('counts a folder reached twice once (the startup disk is listed under /Volumes)', async () => {
    const l = layout()
    fs.symlinkSync(l.fsRoot, path.join(l.fsRoot, 'Volumes', 'Macintosh HD'), 'junction')
    const found = await findCandidatePaths({ platform: 'darwin', homedir: l.home, fsRoot: l.fsRoot })
    expect(found.filter((p) => fs.realpathSync(p) === fs.realpathSync(l.system))).toHaveLength(1)
    expect(found).toContain(l.system)
    expect(found).toHaveLength(4)
  })

  it('recognises a flavor folder that holds only the app bundle', async () => {
    const root = tmpDir()
    mkdirs(root, '_classic_era_', 'World of Warcraft Classic.app', 'Contents', 'MacOS')
    mkdirs(root, '_anniversary_')
    const era = await describeFlavorFolder(path.join(root, '_classic_era_'), 'auto', 'darwin')
    expect(era).toMatchObject({ flavor: 'classic_era', flavorFolder: '_classic_era_' })
    expect(era!.addOnsPath).toBe(path.join(root, '_classic_era_', 'Interface', 'AddOns'))
    expect(await describeFlavorFolder(path.join(root, '_anniversary_'), 'auto', 'darwin')).toBeNull()
  })

  it('a scan finds the games under the usual folders', async () => {
    const l = layout()
    mkdirs(l.system, '_classic_era_', 'World of Warcraft Classic.app')
    mkdirs(l.user, '_anniversary_', 'Interface')
    const games = await scanGames(tmpDir(), { platform: 'darwin', discovery: { platform: 'darwin', homedir: l.home, fsRoot: l.fsRoot } })
    expect(sorted(games.map((g) => g.flavor))).toEqual(['anniversary', 'classic_era'])
    expect(games.every((g) => g.source === 'auto')).toBe(true)
  })

  it('reads macOS paths out of the Battle.net product list', () => {
    const db = Buffer.concat([
      Buffer.from([0x0a, 0x2a]),
      Buffer.from('/Applications/World of Warcraft'),
      Buffer.from([0x12, 0x00, 0xff]),
      Buffer.from('/Volumes/Games/Applications/World of Warcraft')
    ])
    expect(parseProductDb(db)).toEqual(['/Applications/World of Warcraft', '/Volumes/Games/Applications/World of Warcraft'])
  })
})

// ---------------------------------------------------------------- Linux

describe('finding the game on Linux (Wine)', () => {
  const app = (prefix: string, programs = 'Program Files (x86)'): string => path.join(prefix, 'drive_c', programs, WOW)

  it('looks in the prefixes of Wine, Lutris, Bottles, Steam (Proton) and Heroic', async () => {
    const home = tmpDir()
    const custom = tmpDir()
    const expected = [
      mkdirs(app(path.join(home, '.wine'))),
      mkdirs(app(path.join(home, 'Games', 'battlenet'), 'Program Files')),
      mkdirs(app(path.join(home, 'Games', 'my-lutris-wow'))),
      mkdirs(app(path.join(home, '.local', 'share', 'bottles', 'bottles', 'WoW'))),
      mkdirs(app(path.join(home, '.var', 'app', 'com.usebottles.bottles', 'data', 'bottles', 'bottles', 'Flat'))),
      mkdirs(app(path.join(home, '.local', 'share', 'lutris', 'prefixes', 'wow'))),
      mkdirs(app(path.join(home, '.local', 'share', 'Steam', 'steamapps', 'compatdata', '12345', 'pfx'))),
      mkdirs(app(path.join(home, 'Games', 'Heroic', 'Prefixes', 'default', 'World of Warcraft', 'pfx'))),
      mkdirs(app(custom))
    ]
    // Lutris keeps Wine builds under runners: never a game prefix, never searched.
    mkdirs(app(path.join(home, '.local', 'share', 'lutris', 'runners', 'wine', 'lutris-9')))
    const found = await discoverUnixPaths({ platform: 'linux', homedir: home, winePrefix: custom })
    expect(sorted(found)).toEqual(sorted(expected))
  })

  it('finds a plain game folder in ~/Games and ignores a missing WINEPREFIX', async () => {
    const home = tmpDir()
    const plain = mkdirs(home, 'Games', WOW)
    expect(await discoverUnixPaths({ platform: 'linux', homedir: home, winePrefix: path.join(home, 'nope') })).toEqual([plain])
  })

  it('returns nothing, and does not throw, for an empty home, an unreadable one and no time left', async () => {
    const home = tmpDir()
    expect(await discoverUnixPaths({ platform: 'linux', homedir: home })).toEqual([])
    expect(await discoverUnixPaths({ platform: 'linux', homedir: path.join(home, 'missing') })).toEqual([])
    mkdirs(app(path.join(home, '.wine')))
    expect(await discoverUnixPaths({ platform: 'linux', homedir: home, budgetMs: -1 })).toEqual([])
  })

  it('does not search deeper than the prefix folders', async () => {
    const home = tmpDir()
    mkdirs(app(path.join(home, 'Games', 'a', 'b')))
    expect(await discoverUnixPaths({ platform: 'linux', homedir: home })).toEqual([])
  })

  it('a scan turns the found folders into games', async () => {
    const home = tmpDir()
    const root = mkdirs(app(path.join(home, '.wine')))
    mkdirs(root, '_classic_era_', 'Interface', 'AddOns')
    mkdirs(root, '_retail_', 'Interface')
    const games = await scanGames(tmpDir(), { platform: 'linux', discovery: { platform: 'linux', homedir: home, winePrefix: '' } })
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({ flavor: 'classic_era', root: path.join(root, '_classic_era_') })
  })
})

// ---------------------------------------------------------------- letter case in game folders

describe('names inside a game folder keep the case found on disk', () => {
  it('uses interface/addons as they are spelled, and Interface/AddOns when they are missing', async () => {
    const base = tmpDir()
    const lower = mkdirs(base, 'one', '_classic_era_')
    mkdirs(lower, 'interface', 'addons')
    const g = await describeFlavorFolder(lower, 'auto', 'linux')
    expect(g!.addOnsPath).toBe(path.join(lower, 'interface', 'addons'))

    const half = mkdirs(base, 'two', '_classic_era_')
    mkdirs(half, 'Interface')
    expect((await describeFlavorFolder(half, 'auto', 'linux'))!.addOnsPath).toBe(path.join(half, 'Interface', 'AddOns'))

    const none = mkdirs(base, 'three', '_classic_era_')
    mkdirs(none, 'WTF')
    expect((await describeFlavorFolder(none, 'auto', 'linux'))!.addOnsPath).toBe(path.join(none, 'Interface', 'AddOns'))
  })

  it('finds a flavor folder written in capitals', async () => {
    const base = tmpDir()
    mkdirs(base, '_Classic_Era_', 'Interface')
    const res = await resolveGamePath(base, 'manual', 'linux')
    expect(res.games.map((g) => g.flavor)).toEqual(['classic_era'])
  })

  it('names the folder to choose with the separators of the platform', async () => {
    const base = tmpDir()
    mkdirs(base, 'Documents')
    const dir = path.join(base, 'Documents')
    expect((await resolveGamePath(dir, 'manual', 'win32')).error).toContain('Interface\\AddOns')
    expect((await resolveGamePath(dir, 'manual', 'darwin')).error).toContain('Interface/AddOns')
    expect((await resolveGamePath(dir, 'manual', 'linux')).error).toContain('Interface/AddOns')
  })
})

// ---------------------------------------------------------------- linked AddOns folder

describe('an AddOns folder that is itself a link', () => {
  const release: ReleaseInfo = {
    productId: 'spoken',
    tag: 'spoken/v3.5.0',
    version: '3.5.0',
    prerelease: false,
    publishedAt: '2026-10-01T00:00:00Z',
    notes: '',
    assetName: 'Spoken-3.5.0.zip',
    assetSize: 1,
    assetUrl: 'https://example/x.zip',
    htmlUrl: ''
  }

  it('is reported as linked, with the same plain message, and not changed', async () => {
    const game = await makeGame(tmpDir())
    const real = mkdirs(tmpDir(), 'my-addons')
    write(path.join(real, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.5.0'))
    fs.rmSync(game.addOnsPath, { recursive: true })
    fs.symlinkSync(real, game.addOnsPath, 'junction')
    const state = { version: 1 as const, manualGames: [], hiddenGames: [], installs: {} }
    const all = await computeStatuses(game, { ...emptyCatalog(), releases: { spoken: [release] } }, DEFAULT_SETTINGS, state)
    expect(all.find((s) => s.productId === 'spoken')).toMatchObject({
      state: 'linked',
      blockedReason: 'This folder is linked to a development checkout. The manager will not change it.'
    })
  })

  it('is not reported as linked when it is a plain folder', async () => {
    const game = await makeGame(tmpDir())
    write(path.join(game.addOnsPath, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.5.0'))
    const state = { version: 1 as const, manualGames: [], hiddenGames: [], installs: {} }
    const all = await computeStatuses(game, { ...emptyCatalog(), releases: { spoken: [release] } }, DEFAULT_SETTINGS, state)
    expect(all.find((s) => s.productId === 'spoken')!.state).toBe('up-to-date')
  })
})

// ---------------------------------------------------------------- the window

describe('the window frame', () => {
  it('macOS keeps the system buttons, in a strip above the tabs, and the page hides its own', () => {
    const c = windowChrome('darwin')
    expect(c.titleBarStyle).toBe('hiddenInset')
    expect(c.pageDrawsButtons).toBe(false)
    // The strip (--lights-h in styles.css) is 28 px tall: the buttons (about 14 px) fit inside it.
    expect(c.trafficLightPosition!.x).toBeGreaterThanOrEqual(12)
    expect(c.trafficLightPosition!.y + 14).toBeLessThanOrEqual(28)
  })

  it('Windows and Linux are frameless and the page draws the buttons', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(windowChrome(platform)).toMatchObject({ titleBarStyle: 'hidden', pageDrawsButtons: true })
    }
  })

  it('Linux asks for no system frame, so a desktop frame is not drawn beside the page buttons', () => {
    expect(windowChrome('linux').frame).toBe(false)
    expect(windowChrome('win32').frame).toBeUndefined()
    expect(windowChrome('darwin').frame).toBeUndefined()
  })
})

// ---------------------------------------------------------------- the manager's own update

function fakeUpdater() {
  const handlers = new Map<string, (arg: never) => void>()
  const record = { feeds: [] as unknown[], checks: 0, downloads: 0, installs: [] as unknown[][] }
  const emit = (event: string, arg?: unknown): void => handlers.get(event)?.(arg as never)
  const u: UpdaterLike & { downloadUpdate: () => void } = {
    setFeedURL: (o) => {
      record.feeds.push(o)
    },
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: null,
    on(event, listener) {
      handlers.set(event, listener)
      return u
    },
    downloadUpdate: () => {
      record.downloads++
    },
    quitAndInstall: (...args) => {
      record.installs.push(args)
    },
    async checkForUpdates() {
      record.checks++
      emit('checking-for-update')
      emit('update-available', { version: '0.2.0' })
      // What the real updater does when it is allowed to: download, then announce it.
      if (u.autoDownload) {
        emit('download-progress', { percent: 41.6 })
        emit('update-downloaded', { version: '0.2.0' })
      }
    }
  }
  return { u, record, emit }
}

function runUpdater(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  extra: { error?: Error; packaged?: boolean; appVersion?: string; feed?: string | Error; autoUpdate?: boolean } = {}
) {
  const f = fakeUpdater()
  const fetched: string[] = []
  if (extra.error) {
    f.u.checkForUpdates = async () => {
      throw extra.error
    }
  }
  const states: UpdaterState[] = []
  const updater = new ManagerUpdater({
    isPackaged: extra.packaged ?? true,
    appVersion: extra.appVersion ?? '0.1.0',
    autoUpdateManager: () => extra.autoUpdate ?? true,
    fetchText: async (url) => {
      fetched.push(url)
      if (extra.feed instanceof Error) throw extra.feed
      return extra.feed ?? yml('version: 0.2.0', 'files: []')
    },
    send: (s) => states.push(s),
    platform,
    env,
    loadUpdater: async () => f.u
  })
  return { ...f, states, updater, fetched }
}

describe('manager updates per platform', () => {
  it('Windows, macOS, and Linux inside an AppImage, update by themselves', () => {
    expect(updateMode('win32', {})).toBe('auto')
    expect(updateMode('darwin', {})).toBe('auto')
    expect(updateMode('linux', { APPIMAGE: '/home/me/Spoken-Manager.AppImage' })).toBe('auto')
  })

  it('Linux outside an AppImage only points to the download page', () => {
    expect(updateMode('linux', {})).toBe('manual')
  })

  it('Windows downloads and installs on quit', async () => {
    const r = runUpdater('win32', {})
    await r.updater.start()
    expect(r.record.feeds).toEqual([{ provider: 'generic', url: FEED_URL }])
    expect(r.u.autoDownload).toBe(true)
    expect(r.u.autoInstallOnAppQuit).toBe(true)
    expect(r.states.map((s) => s.state)).toEqual(['idle', 'checking', 'available', 'downloading', 'ready'])
    expect(r.states[2]).toEqual({ state: 'available', version: '0.2.0' })
    expect(r.states[3]).toEqual({ state: 'downloading', percent: 42 })
  })

  for (const [name, platform, env] of [
    ['macOS', 'darwin', {}],
    ['an AppImage', 'linux', { APPIMAGE: '/home/me/app.AppImage' }]
  ] as const) {
    it(`${name} does the same`, async () => {
      const r = runUpdater(platform, env)
      await r.updater.start()
      expect(r.u.autoDownload).toBe(true)
      expect(r.states.at(-1)).toEqual({ state: 'ready', version: '0.2.0' })
    })
  }

  for (const [name, platform, env, file] of [
    ['Linux without an AppImage', 'linux', {}, 'latest-linux.yml']
  ] as const) {
    it(`${name} reads ${file} itself, downloads nothing and gives the release page`, async () => {
      const r = runUpdater(platform, env)
      await r.updater.start()
      // electron-updater is not involved at all: it does nothing outside an AppImage.
      expect(r.record.feeds).toEqual([])
      expect(r.record.checks).toBe(0)
      expect(r.record.downloads).toBe(0)
      expect(r.fetched).toEqual([`${FEED_URL}/${file}`])
      expect(r.states.map((s) => s.state)).toEqual(['idle', 'checking', 'available'])
      expect(r.states.at(-1)).toEqual({ state: 'available', version: '0.2.0', url: MANUAL_UPDATE_URL })
    })

    it(`${name} says nothing is new when the feed has the same or an older version`, async () => {
      for (const feed of [yml('version: 0.1.0'), yml('version: 0.0.9'), yml("version: '0.1.0'")]) {
        const r = runUpdater(platform, env, { feed })
        await r.updater.start()
        expect(r.states.at(-1)).toEqual({ state: 'idle' })
      }
    })

    it(`${name} treats a pre-release of a version as older than the release`, async () => {
      const r = runUpdater(platform, env, { appVersion: '0.2.0-beta.1', feed: yml('version: 0.2.0') })
      await r.updater.start()
      expect(r.states.at(-1)).toMatchObject({ state: 'available', version: '0.2.0' })
    })
  }

  it('the feed file is named per platform and its version line is read however it is written', () => {
    expect(feedFileFor('win32')).toBe('latest.yml')
    expect(feedFileFor('darwin')).toBe('latest-mac.yml')
    expect(feedFileFor('linux')).toBe('latest-linux.yml')
    expect(parseFeedVersion(yml('version: 1.2.3', 'files:', '  - url: x', '    sha512: abc'))).toBe('1.2.3')
    expect(parseFeedVersion(yml('files:', '  - url: x', 'version: "1.2.3-beta.1"', 'path: x'))).toBe('1.2.3-beta.1')
    expect(parseFeedVersion(yml('path: x'))).toBeNull()
    expect(parseFeedVersion('')).toBeNull()
  })

  it('a feed that cannot be read or has no version is a silent failure at start and an error when asked', async () => {
    for (const feed of [new Error('offline'), yml('files: []'), yml('version: not-a-version')]) {
      const quiet = runUpdater('linux', {}, { feed })
      await quiet.updater.start()
      expect(quiet.states.at(-1)).toEqual({ state: 'idle' })
      const asked = runUpdater('linux', {}, { feed })
      await asked.updater.checkNow()
      expect(asked.states.at(-1)).toMatchObject({ state: 'error' })
    }
  })

  it('reads the real feed file over http', async () => {
    const requests: string[] = []
    const server: TestServer = await startServer((req, res) => {
      requests.push(req.url ?? '')
      res.setHeader('content-type', 'text/yaml')
      res.end(yml('version: 0.3.0', 'files:', '  - url: Spoken-Manager-0.3.0-linux.tar.gz'))
    })
    try {
      const states: UpdaterState[] = []
      const updater = new ManagerUpdater({
        isPackaged: true,
        appVersion: '0.1.0',
        autoUpdateManager: () => true,
        send: (s) => states.push(s),
        platform: 'linux',
        env: {},
        feedUrl: server.url
      })
      await updater.start()
      expect(requests).toEqual(['/latest-linux.yml'])
      expect(states.at(-1)).toEqual({ state: 'available', version: '0.3.0', url: MANUAL_UPDATE_URL })
    } finally {
      await server.close()
    }
  })

  it('the page to download from is the manager-latest release', () => {
    expect(MANUAL_UPDATE_URL).toBe('https://github.com/rusty-key/spoken-wow/releases/tag/manager-latest')
  })

  it('does not check when the app is not installed or the player switched it off, and says so when asked', async () => {
    const dev = runUpdater('darwin', {}, { packaged: false })
    await dev.updater.start()
    expect(dev.record.checks).toBe(0)
    await dev.updater.checkNow()
    expect(dev.states.at(-1)).toEqual({ state: 'error', message: 'The manager can only update itself when it is installed.' })

    const off = new ManagerUpdater({ isPackaged: true, appVersion: '0.1.0', autoUpdateManager: () => false, send: () => undefined, platform: 'win32', env: {}, loadUpdater: async () => fakeUpdater().u })
    await off.start()
  })

  it('a failed electron-updater check is silent at start and shown when the player asked', async () => {
    const quiet = runUpdater('win32', {}, { error: new Error('offline') })
    await quiet.updater.start()
    expect(quiet.states.map((s) => s.state)).toEqual(['idle', 'idle'])
    const asked = runUpdater('win32', {}, { error: new Error('offline') })
    await asked.updater.checkNow()
    expect(asked.states.at(-1)).toMatchObject({ state: 'error' })
  })

  it('a background check finds an update, stays quiet when it fails, and respects the setting and a dev build', async () => {
    const found = runUpdater('win32', {})
    await found.updater.checkInBackground()
    expect(found.states.at(-1)).toEqual({ state: 'ready', version: '0.2.0' })

    const quiet = runUpdater('win32', {}, { error: new Error('offline') })
    await quiet.updater.checkInBackground()
    expect(quiet.states).toEqual([{ state: 'idle' }])

    for (const extra of [{ autoUpdate: false }, { packaged: false }]) {
      const skipped = runUpdater('win32', {}, extra)
      await skipped.updater.checkInBackground()
      expect(skipped.record.checks).toBe(0)
      expect(skipped.states).toEqual([])
    }
  })

  it('no check starts while an update is ready, downloading or about to download', async () => {
    const ready = runUpdater('win32', {})
    await ready.updater.start()
    await ready.updater.checkInBackground()
    await ready.updater.checkNow()
    expect(ready.record.checks).toBe(1)
    expect(ready.states.at(-1)).toEqual({ state: 'ready', version: '0.2.0' })

    for (const event of [['update-available', { version: '0.2.0' }], ['download-progress', { percent: 5 }]] as const) {
      const going = runUpdater('win32', {})
      going.u.checkForUpdates = async () => {
        going.record.checks++
        going.emit(event[0], event[1])
      }
      await going.updater.start()
      await going.updater.checkNow()
      expect(going.record.checks).toBe(1)
    }
  })

  it('a download page does not stop the next check', async () => {
    const r = runUpdater('linux', {})
    await r.updater.start()
    await r.updater.checkNow()
    expect(r.fetched).toHaveLength(2)
  })

  it('Restart installs silently and starts the new version, only when an update is ready', async () => {
    const r = runUpdater('win32', {})
    r.updater.restart()
    expect(r.record.installs).toEqual([])
    await r.updater.start()
    r.updater.restart()
    expect(r.record.installs).toEqual([[true, true]])

    const manual = runUpdater('linux', {})
    await manual.updater.start()
    manual.updater.restart()
    expect(manual.record.installs).toEqual([])
  })

  it('a failed install keeps the update ready and says so, whether it throws or emits an error', async () => {
    const thrown = runUpdater('win32', {})
    await thrown.updater.start()
    thrown.u.quitAndInstall = () => {
      throw new Error('no installer')
    }
    thrown.updater.restart()
    expect(thrown.states.at(-1)).toMatchObject({ state: 'ready', version: '0.2.0', message: expect.stringContaining('Could not install') })

    const emitted = runUpdater('win32', {})
    await emitted.updater.start()
    emitted.u.quitAndInstall = () => emitted.emit('error', new Error('no installer'))
    emitted.updater.restart()
    expect(emitted.states.at(-1)).toMatchObject({ state: 'ready', version: '0.2.0', message: expect.stringContaining('Could not install') })
  })
})

// ---------------------------------------------------------------- what the window is told

describe('the snapshot names the platform', () => {
  it('is the running one', () => {
    const svc = new ManagerService({ dataPath: tmpDir(), appVersion: '0.1.0', packsBaseUrl: 'http://127.0.0.1:9/', send: () => undefined, autoPaths: [] })
    const expected = process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux'
    expect(svc.snapshot().platform).toBe(expected)
  })
})

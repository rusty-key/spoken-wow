import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CHANNELS } from '../src/shared/api'
import { productById } from '../src/shared/products'
import type { GameInstall, JobProgress } from '../src/shared/types'
import { cleanLeftovers, clearDownloads } from '../src/main/cleanup'
import { communityProduct, communityRelease, validatePack } from '../src/main/community'
import { openableDirectory } from '../src/main/external'
import { checkDownloadsPath } from '../src/main/guard'
import {
  backupDirFor,
  COMMUNITY_LIMITS,
  installProduct,
  OFFICIAL_LIMITS,
  pruneBackups,
  recoverInterrupted,
  scanZip,
  uninstallProduct,
  WORK_DIR,
  type JobContext
} from '../src/main/install'
import { JobManager } from '../src/main/jobs'
import { PlainError } from '../src/main/errors'
import { ManagerService } from '../src/main/service'
import { isOurPage, pageFileUrl } from '../src/main/trust'
import { loadState } from '../src/main/state'
import { collect, makeGame, rawZip, release, serveBuffer, sha256, startServer, tmpDir, toc, write, yazlZip, type TestServer, type ZipEntry } from './helpers'

let server: TestServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

async function serveZip(zip: Buffer): Promise<string> {
  await server?.close()
  server = await startServer((req, res) => serveBuffer(req, res, zip))
  return `${server.url}/asset.zip`
}

function entries(version: string, folders = ['Spoken']): ZipEntry[] {
  return folders.flatMap((f) => [
    { name: `${f}/${f}.toc`, data: toc(f, version) },
    { name: `${f}/${f}.lua`, data: `-- ${f} ${version}` }
  ])
}

function ctx(env: { data: string; downloads: string }, extra: Partial<JobContext> = {}) {
  const { events, emit } = collect()
  return { jobId: 'job1', dataPath: env.data, downloadsPath: env.downloads, keepDownloads: false, emit, backoffMs: 1, attempts: 1, isRunning: async () => false, events, ...extra }
}

async function env() {
  const game = await makeGame(tmpDir())
  return { game, data: tmpDir(), downloads: tmpDir(), addOns: game.addOnsPath }
}

const journalOf = (game: GameInstall): string => path.join(game.addOnsPath, WORK_DIR, 'staging', 'journal.json')

// ---------------------------------------------------------------- trust and what may be opened

describe('which page is trusted', () => {
  const app = tmpDir()
  const index = path.join(app, 'out', 'renderer', 'index.html')
  const page = { indexHtml: index }

  it('is exactly the built index.html, whatever the hash or query', () => {
    const url = pageFileUrl(index)
    expect(isOurPage(url, page)).toBe(true)
    expect(isOurPage(`${url}#/spoken`, page)).toBe(true)
    expect(isOurPage(`${url}?x=1`, page)).toBe(true)
  })

  it('refuses every other file, scheme and host', () => {
    for (const bad of [
      pageFileUrl(path.join(app, 'out', 'renderer', 'other.html')),
      pageFileUrl(path.join(app, 'win.ini')),
      'file://evil-host/share/index.html',
      'https://github.com/',
      'http://localhost:5173/',
      'about:blank',
      'javascript:alert(1)',
      'data:text/html,hi',
      '',
      undefined,
      null,
      42
    ]) {
      expect(isOurPage(bad, page)).toBe(false)
    }
  })

  it('compares the file path with the case rules of the platform', () => {
    const shouty = pageFileUrl(path.join(app, 'out', 'renderer', 'index.html').toUpperCase())
    expect(isOurPage(shouty, page, 'win32')).toBe(true)
    expect(isOurPage(shouty, page, 'darwin')).toBe(true)
    // A URL with the same letters in the same case is ours on every platform.
    expect(isOurPage(pageFileUrl(index), page, 'linux')).toBe(true)
  })

  it('in development is the dev server origin only', () => {
    const dev = { devUrl: 'http://localhost:5173/', indexHtml: index }
    expect(isOurPage('http://localhost:5173/', dev)).toBe(true)
    expect(isOurPage('http://localhost:5173/src/main.tsx', dev)).toBe(true)
    expect(isOurPage('http://localhost:5174/', dev)).toBe(false)
    expect(isOurPage('http://evil.example/', dev)).toBe(false)
    expect(isOurPage(pageFileUrl(index), dev)).toBe(false)
  })
})

describe('openableDirectory', () => {
  it('opens a directory inside a root and nothing else', async () => {
    const base = tmpDir()
    const addOns = path.join(base, 'AddOns')
    write(path.join(addOns, 'Spoken', 'Spoken.toc'), 'x')
    write(path.join(base, 'outside', 'a.txt'), 'x')
    expect(await openableDirectory(addOns, [addOns])).toBe(addOns)
    expect(await openableDirectory(path.join(addOns, 'Spoken'), [addOns])).toBe(path.join(addOns, 'Spoken'))
    await expect(openableDirectory(path.join(addOns, 'Spoken', 'Spoken.toc'), [addOns])).rejects.toThrow(/Only folders/)
    await expect(openableDirectory(path.join(addOns, 'missing'), [addOns])).rejects.toThrow(/does not exist/)
    await expect(openableDirectory(path.join(base, 'outside'), [addOns])).rejects.toThrow(/cannot be opened/)
    await expect(openableDirectory(path.join(addOns, '..', 'outside'), [addOns])).rejects.toThrow(/cannot be opened/)
    await expect(openableDirectory('relative', [addOns])).rejects.toThrow()
  })

  it('never opens a file, even through a link inside a root', async () => {
    const base = tmpDir()
    const addOns = path.join(base, 'AddOns')
    write(path.join(base, 'secret.exe'), 'x')
    fs.mkdirSync(addOns, { recursive: true })
    try {
      fs.symlinkSync(path.join(base, 'secret.exe'), path.join(addOns, 'link'), 'file')
    } catch {
      return // symlinks to files need a privilege on Windows
    }
    await expect(openableDirectory(path.join(addOns, 'link'), [addOns])).rejects.toThrow(/Only folders/)
  })

  it('never opens a macOS app bundle, even through a link', async () => {
    const base = tmpDir()
    const addOns = path.join(base, 'AddOns')
    write(path.join(addOns, 'Evil.app', 'Contents', 'Info.plist'), 'x')
    await expect(openableDirectory(path.join(addOns, 'Evil.app'), [addOns], 'darwin')).rejects.toThrow(/Only folders/)
    expect(await openableDirectory(path.join(addOns, 'Evil.app', 'Contents'), [addOns], 'darwin')).toBe(path.join(addOns, 'Evil.app', 'Contents'))
    expect(await openableDirectory(path.join(addOns, 'Evil.app'), [addOns], 'win32')).toBe(path.join(addOns, 'Evil.app'))
    try {
      fs.symlinkSync(path.join(addOns, 'Evil.app'), path.join(addOns, 'Plain'), 'dir')
    } catch {
      return
    }
    await expect(openableDirectory(path.join(addOns, 'Plain'), [addOns], 'darwin')).rejects.toThrow(/Only folders/)
  })
})

describe('the downloads folder', () => {
  const base = tmpDir()
  const game = { root: path.join(base, 'World of Warcraft', '_forever_'), addOnsPath: path.join(base, 'World of Warcraft', '_forever_', 'Interface', 'AddOns') }

  it('accepts empty (the default), an existing folder and one that can be created', () => {
    expect(checkDownloadsPath('', [game])).toBeNull()
    expect(checkDownloadsPath(tmpDir(), [game])).toBeNull()
    expect(checkDownloadsPath(path.join(tmpDir(), 'new', 'deeper'), [game])).toBeNull()
  })

  it('refuses a relative path and a path with NUL or too long, on every platform', () => {
    expect(checkDownloadsPath('downloads', [game])).toMatch(/full folder path/)
    expect(checkDownloadsPath('downloads', [game], 'win32')).toMatch(/such as D:/)
    expect(checkDownloadsPath('downloads', [game], 'linux')).toContain('such as /home/you/Downloads')
    expect(checkDownloadsPath('downloads', [game], 'darwin')).toMatch(/full folder path/)
    expect(checkDownloadsPath(`${tmpDir()}\0x`, [game])).toMatch(/not a usable/)
    expect(checkDownloadsPath(path.join(tmpDir(), 'x'.repeat(300)), [game], 'win32')).toMatch(/not a usable/)
    expect(checkDownloadsPath(path.join(tmpDir(), 'x'.repeat(1100)), [game], 'linux')).toMatch(/not a usable/)
  })

  it('refuses network folders on Windows only', () => {
    expect(checkDownloadsPath('\\\\server\\share\\dl', [game], 'win32')).toMatch(/Network folders/)
    expect(checkDownloadsPath('//server/share/dl', [game], 'win32')).toMatch(/Network folders/)
    expect(checkDownloadsPath('\\\\?\\C:\\dl', [game], 'win32')).toMatch(/Network folders/)
    // On macOS and Linux a double slash is an ordinary path.
    expect(checkDownloadsPath('//server/share/dl', [game], 'linux') ?? '').not.toMatch(/Network folders/)
    expect(checkDownloadsPath('//server/share/dl', [game], 'darwin') ?? '').not.toMatch(/Network folders/)
  })

  it('keeps downloads out of AddOns and WTF with the case rules of the platform', () => {
    const mac = { root: '/Users/me/wow/_classic_era_', addOnsPath: '/Users/me/wow/_classic_era_/Interface/AddOns' }
    expect(checkDownloadsPath('/USERS/me/wow/_classic_era_/interface/addons/x', [mac], 'darwin')).toMatch(/AddOns or WTF/)
    expect(checkDownloadsPath('/users/me/wow/_classic_era_/wtf/Account', [mac], 'darwin')).toMatch(/AddOns or WTF/)
    // Linux tells the spellings apart, so another spelling is another folder.
    expect(checkDownloadsPath('/Users/me/wow/_classic_era_/Interface/AddOns/x', [mac], 'linux')).toMatch(/AddOns or WTF/)
    expect(checkDownloadsPath('/Users/me/wow/_classic_era_/WTF/Account', [mac], 'linux')).toMatch(/AddOns or WTF/)
    expect(checkDownloadsPath('/USERS/me/wow/_classic_era_/interface/addons/x', [mac], 'linux') ?? '').not.toMatch(/AddOns or WTF/)
    const win = { root: 'C:\\wow\\_classic_era_', addOnsPath: 'C:\\wow\\_classic_era_\\Interface\\AddOns' }
    expect(checkDownloadsPath('c:\\WOW\\_classic_era_\\wtf\\x', [win], 'win32')).toMatch(/AddOns or WTF/)
  })

  it('protects a WTF folder under the spelling it has on disk', () => {
    const root = tmpDir()
    fs.mkdirSync(path.join(root, 'wtf'))
    const g = { root, addOnsPath: path.join(root, 'Interface', 'AddOns') }
    expect(checkDownloadsPath(path.join(root, 'wtf', 'Account'), [g])).toMatch(/AddOns or WTF/)
  })

  it('refuses a folder inside a game AddOns or WTF folder', () => {
    expect(checkDownloadsPath(game.addOnsPath, [game])).toMatch(/AddOns or WTF/)
    expect(checkDownloadsPath(path.join(game.addOnsPath, 'Spoken'), [game])).toMatch(/AddOns or WTF/)
    expect(checkDownloadsPath(path.join(game.root, 'WTF', 'Account'), [game])).toMatch(/AddOns or WTF/)
    expect(checkDownloadsPath(path.join(game.root, 'Logs'), [game])).toBeNull()
  })

  it('refuses a file and a place below a file', () => {
    const dir = tmpDir()
    write(path.join(dir, 'a.txt'), 'x')
    expect(checkDownloadsPath(path.join(dir, 'a.txt'), [game])).toMatch(/file, not a folder/)
    expect(checkDownloadsPath(path.join(dir, 'a.txt', 'sub'), [game])).toMatch(/file is in the way/)
  })

  it('the service rejects a bad downloads folder in plain words and keeps the old one', async () => {
    const e = await env()
    const svc = new ManagerService({ dataPath: tmpDir(), appVersion: '0.1.0', packsBaseUrl: 'http://127.0.0.1:9/', send: () => undefined, autoPaths: [e.game.root] })
    await svc.init()
    expect(() => svc.setSettings({ downloadsPath: e.game.addOnsPath })).toThrow(PlainError)
    expect(() => svc.setSettings({ downloadsPath: 'relative' })).toThrow(/full folder path/)
    expect(svc.settings.downloadsPath).toBe('')
    const ok = path.join(tmpDir(), 'dl')
    expect(svc.setSettings({ downloadsPath: ok }).downloadsPath).toBe(ok)
    expect(svc.setSettings({ downloadsPath: '' }).downloadsPath).toBe('')
  })
})

// ---------------------------------------------------------------- jobs

describe('JobManager.cancelAll', () => {
  it('stops queued and running jobs and waits until their rollback has finished', async () => {
    const events: JobProgress[] = []
    const jm = new JobManager((p) => events.push(p))
    let rolledBack = false
    jm.enqueue({
      gameId: 'g',
      productId: 'a',
      action: 'install',
      run: ({ signal }) =>
        new Promise<void>((_res, rej) =>
          signal.addEventListener('abort', () =>
            setTimeout(() => {
              rolledBack = true
              rej(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
            }, 30)
          )
        )
    })
    jm.enqueue({ gameId: 'g', productId: 'b', action: 'install', run: async () => undefined })
    await new Promise((r) => setTimeout(r, 5))
    await jm.cancelAll()
    expect(rolledBack).toBe(true)
    expect(jm.active()).toEqual([])
    expect(events.filter((e) => e.phase === 'cancelled')).toHaveLength(2)
    await jm.cancelAll() // nothing left: resolves at once
  })

  it('reports a rollback that failed as an error, not as "Cancelled."', async () => {
    const events: JobProgress[] = []
    const jm = new JobManager((p) => events.push(p))
    jm.enqueue({
      gameId: 'g',
      productId: 'a',
      action: 'install',
      run: ({ signal }) =>
        new Promise<void>((_res, rej) =>
          signal.addEventListener('abort', () => rej(new PlainError('Cancelled, but the manager could not put back Spoken. The previous version is in X.')))
        )
    })
    await new Promise((r) => setTimeout(r, 5))
    await jm.cancelAll()
    expect(events.at(-1)).toMatchObject({ phase: 'error', message: expect.stringContaining('could not put back Spoken') })
  })
})

// ---------------------------------------------------------------- swaps, journal, recovery

describe('a swap that is cut short', () => {
  const failingRestore = (game: GameInstall): Partial<JobContext['ops']> => ({
    rename: async (from, to) => {
      if (from.includes(`${path.sep}staging${path.sep}`) && path.basename(to) === 'Spoken_Places') throw new Error('disk on fire')
      if (from.includes(`${path.sep}backup${path.sep}`)) throw new Error('cannot restore')
      await fs.promises.rename(from, to)
    },
    rm: async (p) => {
      if (p.startsWith(game.addOnsPath) && p.endsWith(`${path.sep}Spoken`)) throw new Error('cannot remove')
      await fs.promises.rm(p, { recursive: true, force: true })
    }
  })

  async function twoFolderZip(version: string): Promise<{ rel: ReturnType<typeof release>; zip: Buffer }> {
    const zip = await yazlZip(entries(version, ['Spoken', 'Spoken_Places']))
    return { rel: release('spoken', version, zip, await serveZip(zip)), zip }
  }

  it('says where the previous version is when the rollback fails, keeps the journal, and the next attempt restores it first', async () => {
    const e = await env()
    write(path.join(e.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
    write(path.join(e.addOns, 'Spoken_Places', 'Spoken_Places.toc'), toc('Spoken_Places', '3.4.0'))
    const { rel } = await twoFolderZip('3.5.0')
    const c = ctx(e, { ops: failingRestore(e.game) })
    const err = await installProduct(e.game, productById('spoken')!, rel, c).catch((x) => x)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/could not put back Spoken/)
    expect(err.message).toContain(`The previous version is in ${backupDirFor(e.game, 'spoken')}`)
    expect(fs.existsSync(journalOf(e.game))).toBe(true)
    // The old Spoken is safe in the backup.
    expect(fs.readFileSync(path.join(backupDirFor(e.game, 'spoken'), 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')

    // The next attempt first undoes the interrupted change (with working file operations), then installs.
    const c2 = ctx(e)
    await installProduct(e.game, productById('spoken')!, rel, c2)
    expect(fs.existsSync(journalOf(e.game))).toBe(false)
    expect(fs.readFileSync(path.join(e.addOns, 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.5.0')
    expect(fs.readFileSync(path.join(backupDirFor(e.game, 'spoken'), 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')
  })

  it('refuses to start another change while the last one still cannot be undone', async () => {
    const e = await env()
    write(path.join(e.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
    write(path.join(e.addOns, 'Spoken_Places', 'Spoken_Places.toc'), toc('Spoken_Places', '3.4.0'))
    const { rel } = await twoFolderZip('3.5.0')
    await installProduct(e.game, productById('spoken')!, rel, ctx(e, { ops: failingRestore(e.game) })).catch(() => undefined)
    const again = await installProduct(e.game, productById('spoken')!, rel, ctx(e, { ops: failingRestore(e.game) })).catch((x) => x)
    expect(again).toBeInstanceOf(PlainError)
    expect(again.message).toMatch(/earlier change .* could not be undone/)
    expect(again.message).toContain(backupDirFor(e.game, 'spoken'))
    expect(fs.readFileSync(path.join(backupDirFor(e.game, 'spoken'), 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')
    expect(fs.existsSync(journalOf(e.game))).toBe(true)
  })

  it('undoes a crash from the journal alone, once, and never touches anything else', async () => {
    const e = await env()
    const backup = backupDirFor(e.game, 'spoken')
    // As a crash leaves it: Spoken was backed up and the new one was being placed; Spoken_Places not yet reached.
    write(path.join(backup, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
    write(path.join(e.addOns, 'Spoken', 'partial.lua'), 'half a copy')
    write(path.join(e.addOns, 'Spoken_Places', 'Spoken_Places.toc'), toc('Spoken_Places', '3.4.0'))
    write(path.join(e.game.root, 'WTF', 'Account', 'ME.lua'), 'saved')
    fs.mkdirSync(path.dirname(journalOf(e.game)), { recursive: true })
    fs.writeFileSync(
      journalOf(e.game),
      JSON.stringify({
        productId: 'spoken',
        entries: [
          { folder: 'Spoken', hadOld: true, phase: 'placing' },
          { folder: 'Spoken_Places', hadOld: true, phase: 'start' },
          { folder: 'WTF', hadOld: true, phase: 'placed' },
          { folder: '..', hadOld: false, phase: 'placed' }
        ]
      })
    )
    expect(await recoverInterrupted(e.game)).toEqual([])
    expect(fs.readFileSync(path.join(e.addOns, 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')
    expect(fs.existsSync(path.join(e.addOns, 'Spoken', 'partial.lua'))).toBe(false)
    expect(fs.existsSync(path.join(e.addOns, 'Spoken_Places', 'Spoken_Places.toc'))).toBe(true)
    expect(fs.readFileSync(path.join(e.game.root, 'WTF', 'Account', 'ME.lua'), 'utf8')).toBe('saved')
    expect(fs.existsSync(journalOf(e.game))).toBe(false)
    // Nothing to do the second time.
    expect(await recoverInterrupted(e.game)).toEqual([])
    expect(fs.readFileSync(path.join(e.addOns, 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')
  })

  it('does not delete the folder in place when its backup is already gone (a rollback that had finished)', async () => {
    const e = await env()
    write(path.join(e.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
    fs.mkdirSync(path.dirname(journalOf(e.game)), { recursive: true })
    fs.writeFileSync(journalOf(e.game), JSON.stringify({ productId: 'spoken', entries: [{ folder: 'Spoken', hadOld: true, phase: 'placed' }] }))
    expect(await recoverInterrupted(e.game)).toEqual([])
    expect(fs.readFileSync(path.join(e.addOns, 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')
  })

  it('ignores a journal that is damaged or names a bad product', async () => {
    const e = await env()
    fs.mkdirSync(path.dirname(journalOf(e.game)), { recursive: true })
    fs.writeFileSync(journalOf(e.game), '{not json')
    expect(await recoverInterrupted(e.game)).toEqual([])
    fs.writeFileSync(journalOf(e.game), JSON.stringify({ productId: '../../x', entries: [{ folder: 'Spoken', hadOld: true, phase: 'placed' }] }))
    expect(await recoverInterrupted(e.game)).toEqual([])
    expect(fs.existsSync(journalOf(e.game))).toBe(false)
  })

  it('writes no journal after a clean install or a clean rollback', async () => {
    const e = await env()
    const zip = await yazlZip(entries('1.0.0'))
    await installProduct(e.game, productById('spoken')!, release('spoken', '1.0.0', zip, await serveZip(zip)), ctx(e))
    expect(fs.existsSync(journalOf(e.game))).toBe(false)
    write(path.join(e.addOns, 'Spoken_Places', 'Spoken_Places.toc'), toc('Spoken_Places', '1'))
    const two = await twoFolderZip('1.1.0')
    const bad = ctx(e, {
      ops: {
        rename: async (from, to) => {
          if (from.includes(`${path.sep}staging${path.sep}`) && path.basename(to) === 'Spoken_Places') throw new Error('nope')
          await fs.promises.rename(from, to)
        }
      }
    })
    await expect(installProduct(e.game, productById('spoken')!, two.rel, bad)).rejects.toBeInstanceOf(PlainError)
    expect(fs.existsSync(journalOf(e.game))).toBe(false)
  })
})

// ---------------------------------------------------------------- limits and per-game files

describe('zip limits', () => {
  it('counts what a zip would unpack to, and refuses above the limits', async () => {
    const dir = tmpDir()
    const small = path.join(dir, 'small.zip')
    fs.writeFileSync(small, await yazlZip(entries('1.0.0', ['Spoken', 'Spoken_Places'])))
    const counted = await scanZip(small, OFFICIAL_LIMITS)
    expect(counted.entries).toBe(4)
    expect(counted.bytes).toBeGreaterThan(0)

    const big = path.join(dir, 'big.zip')
    fs.writeFileSync(big, rawZip([{ name: 'SpokenCommunity_x/a.ogg', data: 'x', declaredSize: 3 * 1024 ** 3 }]))
    await expect(scanZip(big, COMMUNITY_LIMITS)).rejects.toThrow(/unpack to more than 2\.0 GB/)
    expect((await scanZip(big, OFFICIAL_LIMITS)).bytes).toBe(3 * 1024 ** 3)

    const huge = path.join(dir, 'huge.zip')
    fs.writeFileSync(huge, rawZip([{ name: 'Spoken/a.ogg', data: 'x', declaredSize: 4_000_000_000 }, { name: 'Spoken/b.ogg', data: 'x', declaredSize: 4_000_000_000 }]))
    await expect(scanZip(huge, OFFICIAL_LIMITS)).rejects.toThrow(/more than 6\.0 GB/)
  })

  // 20,001 entries take 2-5 s on the Windows runner.
  it('counts entries', async () => {
    const dir = tmpDir()
    const file = path.join(dir, 'many.zip')
    fs.writeFileSync(file, rawZip(Array.from({ length: 20_001 }, (_, i) => ({ name: `SpokenCommunity_x/f${i}`, data: '' }))))
    await expect(scanZip(file, COMMUNITY_LIMITS)).rejects.toThrow(/more than 20,000 files/)
    expect((await scanZip(file, OFFICIAL_LIMITS)).entries).toBe(20_001)
  }, 30_000)

  it('refuses a community pack above its limit before extracting anything', async () => {
    const e = await env()
    const folder = 'SpokenCommunity_elune'
    const zip = rawZip([
      { name: `${folder}/${folder}.toc`, data: toc(folder, '1.0.0') },
      { name: `${folder}/a.ogg`, data: 'x', declaredSize: 3 * 1024 ** 3 }
    ])
    await serveZip(zip)
    const parsed = validatePack({
      id: 'elune',
      title: 'Elune',
      author: 'E',
      description: 'd',
      lang: 'deDE',
      section: 'quests',
      version: '1.0.0',
      size: zip.length,
      sha256: sha256(zip),
      url: 'https://github.com/a/b/releases/download/v1/p.zip',
      addedAt: '2026-10-18'
    }) as { pack: Parameters<typeof communityProduct>[0] & Parameters<typeof communityRelease>[0] }
    const rel = { ...communityRelease(parsed.pack), assetUrl: `${server!.url}/p.zip` }
    const err = await installProduct(e.game, communityProduct(parsed.pack), rel, ctx(e)).catch((x) => x)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/unpack to more than 2\.0 GB/)
    expect(fs.existsSync(path.join(e.addOns, folder))).toBe(false)
    expect(fs.existsSync(path.join(e.addOns, WORK_DIR, 'staging', 'job1'))).toBe(false)
  })

  it('keys the downloaded file by game, so one pack going to two games shares no file', async () => {
    const a = await env()
    const b = await makeGame(tmpDir())
    const zip = await yazlZip(entries('1.0.0'))
    const rel = release('spoken', '1.0.0', zip, await serveZip(zip))
    await installProduct(a.game, productById('spoken')!, rel, ctx(a, { keepDownloads: true }))
    await installProduct(b, productById('spoken')!, rel, ctx(a, { keepDownloads: true }))
    expect(fs.readdirSync(a.downloads).sort()).toEqual([`${a.game.id}-spoken-1.0.0.zip`, `${b.id}-spoken-1.0.0.zip`].sort())
  })
})

// ---------------------------------------------------------------- housekeeping

describe('backups, repair, leftovers and downloads', () => {
  it('keeps only the backup of the job just done', async () => {
    const e = await env()
    write(path.join(e.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '1.0.0'))
    write(path.join(backupDirFor(e.game, 'places-audio'), 'SpokenPlacesAudio', 'old.ogg'), 'old pack')
    write(path.join(backupDirFor(e.game, 'community/elune'), 'SpokenCommunity_elune', 'x.ogg'), 'old community')
    const zip = await yazlZip(entries('2.0.0'))
    await installProduct(e.game, productById('spoken')!, release('spoken', '2.0.0', zip, await serveZip(zip)), ctx(e))
    const backups = path.join(e.addOns, WORK_DIR, 'backup')
    expect(fs.readdirSync(backups)).toEqual(['spoken'])
    expect(fs.readFileSync(path.join(backups, 'spoken', 'Spoken', 'Spoken.toc'), 'utf8')).toContain('1.0.0')
  })

  it('prunes around a community backup and an uninstall keeps its own backup', async () => {
    const e = await env()
    write(path.join(backupDirFor(e.game, 'spoken'), 'Spoken', 'a.lua'), 'x')
    write(path.join(backupDirFor(e.game, 'community/a'), 'SpokenCommunity_a', 'a.ogg'), 'x')
    write(path.join(backupDirFor(e.game, 'community/b'), 'SpokenCommunity_b', 'b.ogg'), 'x')
    await pruneBackups(e.game, 'community/a')
    expect(fs.readdirSync(path.join(e.addOns, WORK_DIR, 'backup'))).toEqual(['community'])
    expect(fs.readdirSync(path.join(e.addOns, WORK_DIR, 'backup', 'community'))).toEqual(['a'])

    write(path.join(e.addOns, 'SpokenPlacesAudio', 'SpokenPlacesAudio.toc'), toc('x', '1'))
    await uninstallProduct(e.game, productById('places-audio')!, ctx(e))
    expect(fs.readdirSync(path.join(e.addOns, WORK_DIR, 'backup'))).toEqual(['places-audio'])
  })

  it('empties staging at start but keeps a swap journal, and drops old half-finished downloads and orphan records', async () => {
    const e = await env()
    const staging = path.join(e.addOns, WORK_DIR, 'staging')
    write(path.join(staging, 'oldjob', 'Spoken', 'x.lua'), 'x')
    write(path.join(staging, 'otherjob', 'y.lua'), 'y')
    write(journalOf(e.game), '{}')
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000)
    write(path.join(e.downloads, 'old.zip.part'), 'x')
    write(path.join(e.downloads, 'old.zip.part.meta'), '{}')
    fs.utimesSync(path.join(e.downloads, 'old.zip.part'), old, old)
    write(path.join(e.downloads, 'fresh.zip.part'), 'x')
    write(path.join(e.downloads, 'fresh.zip.part.meta'), '{}')
    write(path.join(e.downloads, 'orphan.zip.part.meta'), '{}')
    write(path.join(e.downloads, 'keep.zip'), 'a kept zip')
    await cleanLeftovers([e.game], e.downloads)
    expect(fs.readdirSync(staging)).toEqual(['journal.json'])
    expect(fs.readdirSync(e.downloads).sort()).toEqual(['fresh.zip.part', 'fresh.zip.part.meta', 'keep.zip'])
  })

  it('clears the zips and half-finished zips and nothing else', async () => {
    const dir = tmpDir()
    write(path.join(dir, 'a.zip'), 'x'.repeat(100))
    write(path.join(dir, 'b.zip.part'), 'x'.repeat(50))
    write(path.join(dir, 'b.zip.part.meta'), '{}')
    write(path.join(dir, 'notes.txt'), 'mine')
    fs.mkdirSync(path.join(dir, 'folder.zip'))
    const res = await clearDownloads(dir)
    expect(res.files).toBe(2)
    expect(res.bytes).toBe(152)
    expect(fs.readdirSync(dir).sort()).toEqual(['folder.zip', 'notes.txt'])
    expect(await clearDownloads(path.join(dir, 'missing'))).toEqual({ files: 0, bytes: 0 })
  })

  it('service: repair puts back the installed version; refuses when nothing is installed or the version left the list', async () => {
    const e = await env()
    const zip = await yazlZip(entries('3.5.0'))
    server = await startServer((req, res) => serveBuffer(req, res, zip))
    const releases = [
      {
        tag_name: 'spoken/v3.5.0',
        published_at: '2026-10-01T00:00:00Z',
        body: '',
        html_url: '',
        assets: [{ name: 'Spoken-3.5.0.zip', size: zip.length, browser_download_url: `${server.url}/Spoken-3.5.0.zip`, digest: `sha256:${sha256(zip)}`, state: 'uploaded' }]
      }
    ]
    let list: unknown[] = releases
    const sent: { channel: string; payload: unknown }[] = []
    const svc = new ManagerService({
      dataPath: e.data,
      appVersion: '0.1.0',
      packsBaseUrl: 'http://127.0.0.1:9/',
      send: (channel, payload) => sent.push({ channel, payload }),
      fetchImpl: (async (url: string, init?: RequestInit) =>
        String(url).startsWith('https://api.github.com/') ? new Response(JSON.stringify(list), { status: 200 }) : fetch(url, init)) as unknown as typeof fetch,
      autoPaths: [e.game.root],
      isRunning: async () => false,
      backoffMs: 1
    })
    await svc.init()
    await svc.refreshCatalog(true)
    const last = (id: string): Promise<JobProgress> =>
      new Promise((resolve) => {
        const t = setInterval(() => {
          const p = sent.filter((s) => s.channel === CHANNELS.jobProgress && (s.payload as JobProgress).jobId === id).map((s) => s.payload as JobProgress).at(-1)
          if (p && ['done', 'error', 'cancelled'].includes(p.phase)) {
            clearInterval(t)
            resolve(p)
          }
        }, 10)
      })

    expect(await last(svc.install(e.game.id, 'spoken', { repair: true }))).toMatchObject({ action: 'repair', phase: 'error', message: expect.stringMatching(/nothing to repair/) })

    expect((await last(svc.install(e.game.id, 'spoken'))).phase).toBe('done')
    // Damage the install, then repair it.
    fs.rmSync(path.join(e.addOns, 'Spoken', 'Spoken.lua'))
    const repaired = await last(svc.install(e.game.id, 'spoken', { repair: true }))
    expect(repaired).toMatchObject({ phase: 'done', version: '3.5.0' })
    expect(repaired.message).toBe('Repaired. Reload the game (/reload) or restart it to use it.')
    expect(fs.existsSync(path.join(e.addOns, 'Spoken', 'Spoken.lua'))).toBe(true)

    // The installed version leaves the list: no repair, and nothing is touched.
    list = []
    await svc.refreshCatalog(true)
    expect(await last(svc.install(e.game.id, 'spoken', { repair: true }))).toMatchObject({ phase: 'error', message: expect.stringMatching(/no longer in the list/) })
    expect(loadState(e.data).installs[e.game.id]!.spoken!.version).toBe('3.5.0')
  })

  it('service: forgets the last game when it is gone, clears downloads, refuses while a job runs', async () => {
    const e = await env()
    const svc = new ManagerService({ dataPath: e.data, appVersion: '0.1.0', packsBaseUrl: 'http://127.0.0.1:9/', send: () => undefined, autoPaths: [e.game.root] })
    svc.setSettings({ lastGameId: 'a-game-from-an-earlier-run' })
    await svc.init()
    expect(svc.settings.lastGameId).toBe('')
    svc.setSettings({ lastGameId: e.game.id })
    await svc.scan()
    expect(svc.settings.lastGameId).toBe(e.game.id)

    write(path.join(svc.downloadsPath(), 'x.zip'), 'abc')
    expect(await svc.clearDownloads()).toEqual({ files: 1, bytes: 3 })
    let go!: () => void
    const gate = new Promise<void>((r) => (go = r))
    svc.jobs.enqueue({ gameId: e.game.id, productId: 'p', action: 'install', run: () => gate })
    await expect(svc.clearDownloads()).rejects.toThrow(/Wait for the running/)
    go()
  })

  it('service: start-up undoes an interrupted swap and cleans staging', async () => {
    const e = await env()
    const backup = backupDirFor(e.game, 'spoken')
    write(path.join(backup, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
    write(path.join(e.addOns, WORK_DIR, 'staging', 'job9', 'x.lua'), 'x')
    fs.writeFileSync(journalOf(e.game), JSON.stringify({ productId: 'spoken', entries: [{ folder: 'Spoken', hadOld: true, phase: 'backedUp' }] }))
    const svc = new ManagerService({ dataPath: e.data, appVersion: '0.1.0', packsBaseUrl: 'http://127.0.0.1:9/', send: () => undefined, autoPaths: [e.game.root] })
    await svc.init()
    expect(fs.readFileSync(path.join(e.addOns, 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')
    expect(fs.readdirSync(path.join(e.addOns, WORK_DIR, 'staging'))).toEqual([])
  })
})

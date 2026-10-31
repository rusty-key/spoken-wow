import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { productById } from '../src/shared/products'
import type { GameInstall } from '../src/shared/types'
import { isAbortError, PlainError } from '../src/main/errors'
import { backupDirFor, installProduct, uninstallProduct, WORK_DIR, type JobContext } from '../src/main/install'
import { loadState } from '../src/main/state'
import { collect, listDir, makeGame, rawZip, release, serveBuffer, startServer, tmpDir, toc, write, yazlZip, type TestServer, type ZipEntry } from './helpers'

let server: TestServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

interface Env {
  data: string
  downloads: string
  game: GameInstall
  addOns: string
  wtf: string
}

async function setup(): Promise<Env> {
  const base = tmpDir()
  const game = await makeGame(base)
  const wtf = path.join(game.root, 'WTF')
  write(path.join(wtf, 'Account', 'ME', 'SavedVariables', 'Spoken.lua'), 'SpokenDB = { precious = true }')
  return { data: tmpDir(), downloads: tmpDir(), game, addOns: game.addOnsPath, wtf }
}

function spokenEntries(version: string, folders = ['Spoken', 'Spoken_Places']): ZipEntry[] {
  const out: ZipEntry[] = []
  for (const f of folders) {
    out.push({ name: `${f}/${f}.toc`, data: toc(f, version) }, { name: `${f}/${f}.lua`, data: `-- ${f} ${version}` }, { name: `${f}/sub/data.lua`, data: 'x'.repeat(5000) })
  }
  return out
}

async function serveZip(zip: Buffer): Promise<string> {
  server = await startServer((req, res) => serveBuffer(req, res, zip))
  return `${server.url}/asset.zip`
}

function ctx(env: Env, extra: Partial<JobContext> = {}): JobContext & { events: ReturnType<typeof collect>['events'] } {
  const { events, emit } = collect()
  return {
    jobId: 'job1',
    dataPath: env.data,
    downloadsPath: env.downloads,
    keepDownloads: false,
    emit,
    backoffMs: 1,
    attempts: 1,
    isRunning: async () => false,
    events,
    ...extra
  }
}

/** Every file below `dir` with its content, for before/after comparisons. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8')
    }
  }
  walk(dir)
  return out
}

function noStaging(env: Env): void {
  expect(fs.existsSync(path.join(env.addOns, WORK_DIR, 'staging'))).toBe(false)
}

describe('installProduct: success', () => {
  it('installs Spoken, records it, removes the zip and the staging folder, and reports phases', async () => {
    const env = await setup()
    const zip = await yazlZip(spokenEntries('3.5.0'))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    const c = ctx(env)
    const result = await installProduct(env.game, productById('spoken')!, rel, c)

    expect(result.folders).toEqual(['Spoken', 'Spoken_Places'])
    expect(fs.readFileSync(path.join(env.addOns, 'Spoken', 'Spoken.toc'), 'utf8')).toContain('## Version: 3.5.0')
    expect(fs.readFileSync(path.join(env.addOns, 'Spoken_Places', 'sub', 'data.lua'), 'utf8')).toHaveLength(5000)
    expect(loadState(env.data).installs[env.game.id]!.spoken).toMatchObject({
      version: '3.5.0',
      folders: ['Spoken', 'Spoken_Places'],
      tag: 'spoken/v3.5.0'
    })
    expect(fs.readdirSync(env.downloads)).toEqual([])
    noStaging(env)
    expect(listDir(env.addOns)).toEqual([WORK_DIR, 'Spoken', 'Spoken_Places'].sort())

    const phases = c.events.map((e) => e.phase)
    for (const p of ['downloading', 'extracting', 'installing', 'done'] as const) expect(phases).toContain(p)
    expect(phases.at(-1)).toBe('done')
    expect(phases.indexOf('downloading')).toBeLessThan(phases.indexOf('extracting'))
    expect(phases.indexOf('extracting')).toBeLessThan(phases.indexOf('installing'))
    const last = c.events.at(-1)!
    expect(last).toMatchObject({ jobId: 'job1', gameId: env.game.id, productId: 'spoken', action: 'install', version: '3.5.0' })
    expect(last.message).toBe('Reload the game (/reload) or restart it to use it.')
    expect(c.events.find((e) => e.phase === 'downloading')!.total).toBe(zip.length)
  })

  it('says so when the game is running (and asks for a restart when new folders appeared)', async () => {
    const env = await setup()
    const zip = await yazlZip(spokenEntries('1.0.0'))
    const rel = release('spoken', '1.0.0', zip, await serveZip(zip))
    const first = await installProduct(env.game, productById('spoken')!, rel, ctx(env, { isRunning: async () => true }))
    expect(first.gameRunning).toBe(true)
    expect(first.message).toBe('The game is running. Restart it to load the new files.')
    const second = await installProduct(env.game, productById('spoken')!, rel, ctx(env, { isRunning: async () => true }))
    expect(second.message).toBe('The game is running. Reload the game (/reload) or restart it to use it.')
  })

  it('keeps the zip when asked', async () => {
    const env = await setup()
    const zip = await yazlZip(spokenEntries('3.5.0'))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    await installProduct(env.game, productById('spoken')!, rel, ctx(env, { keepDownloads: true }))
    expect(fs.readdirSync(env.downloads)).toEqual([`${env.game.id}-spoken-3.5.0.zip`])
  })

  it('installs a voice pack bundle with exactly its folders', async () => {
    const env = await setup()
    const product = productById('quests-audio')!
    const zip = await yazlZip(product.folders!.flatMap((f) => [{ name: `${f}/${f}.toc`, data: toc(f, '2') }, { name: `${f}/a.ogg`, data: 'ogg' }]))
    const rel = release('quests-audio', '2', zip, await serveZip(zip))
    const result = await installProduct(env.game, product, rel, ctx(env))
    expect(result.folders.sort()).toEqual([...product.folders!].sort())
    expect(listDir(env.addOns)).toEqual([WORK_DIR, ...product.folders!].sort())
  })

  it('installs a release from before the section was renamed, with its old folder', async () => {
    const env = await setup()
    const product = productById('places-audio-deDE')!
    const zip = await yazlZip([{ name: 'SpokenZonesAudio_deDE/SpokenZonesAudio_deDE.toc', data: toc('x', '2.1.1') }, { name: 'SpokenZonesAudio_deDE/a.ogg', data: 'ogg' }])
    const result = await installProduct(env.game, product, release('places-audio-deDE', '2.1.1', zip, await serveZip(zip)), ctx(env))
    expect(result.folders).toEqual(['SpokenZonesAudio_deDE'])
    expect(listDir(env.addOns)).toEqual([WORK_DIR, 'SpokenZonesAudio_deDE'].sort())
  })

  it('moves a folder from another product to the new owner in the record', async () => {
    const env = await setup()
    const all = productById('quests-audio')!
    const zipAll = await yazlZip(all.folders!.flatMap((f) => [{ name: `${f}/${f}.toc`, data: toc(f, '2') }]))
    await installProduct(env.game, all, release('quests-audio', '2', zipAll, await serveZip(zipAll)), ctx(env))
    await server!.close()
    const split = productById('quests-audio-alliance')!
    const zipOne = await yazlZip([{ name: 'SpokenQuestsAudioAlliance/SpokenQuestsAudioAlliance.toc', data: toc('x', '3') }])
    await installProduct(env.game, split, release('quests-audio-alliance', '3', zipOne, await serveZip(zipOne)), ctx(env))
    const rec = loadState(env.data).installs[env.game.id]!
    expect(rec['quests-audio']!.folders).not.toContain('SpokenQuestsAudioAlliance')
    expect(rec['quests-audio']!.folders).toHaveLength(3)
    expect(rec['quests-audio-alliance']!.folders).toEqual(['SpokenQuestsAudioAlliance'])
  })

  it('updates in place: the old folder goes to the backup, WTF and other add-ons are untouched', async () => {
    const env = await setup()
    write(path.join(env.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
    write(path.join(env.addOns, 'Spoken', 'old-only.lua'), 'old')
    write(path.join(env.addOns, 'OtherAddon', 'OtherAddon.toc'), toc('OtherAddon', '1'))
    const wtfBefore = snapshot(env.wtf)
    const otherBefore = snapshot(path.join(env.addOns, 'OtherAddon'))

    const zip = await yazlZip(spokenEntries('3.5.0'))
    await installProduct(env.game, productById('spoken')!, release('spoken', '3.5.0', zip, await serveZip(zip)), ctx(env))

    expect(fs.existsSync(path.join(env.addOns, 'Spoken', 'old-only.lua'))).toBe(false)
    expect(fs.readFileSync(path.join(env.addOns, 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.5.0')
    expect(fs.readFileSync(path.join(backupDirFor(env.game, 'spoken'), 'Spoken', 'old-only.lua'), 'utf8')).toBe('old')
    expect(snapshot(env.wtf)).toEqual(wtfBefore)
    expect(snapshot(path.join(env.addOns, 'OtherAddon'))).toEqual(otherBefore)
  })

  it('replaces the previous backup on the next install', async () => {
    const env = await setup()
    write(path.join(env.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '1.0.0'))
    for (const v of ['2.0.0', '3.0.0']) {
      const zip = await yazlZip(spokenEntries(v, ['Spoken']))
      await installProduct(env.game, productById('spoken')!, release('spoken', v, zip, await serveZip(zip)), ctx(env))
      await server!.close()
    }
    expect(fs.readFileSync(path.join(backupDirFor(env.game, 'spoken'), 'Spoken', 'Spoken.toc'), 'utf8')).toContain('2.0.0')
  })
})

describe('installProduct: refusals', () => {
  async function expectRefused(env: Env, entries: ZipEntry[] | Buffer, productId = 'spoken', pattern?: RegExp): Promise<void> {
    const zip = Buffer.isBuffer(entries) ? entries : rawZip(entries)
    const rel = release(productId, '1.0.0', zip, await serveZip(zip))
    const before = snapshot(env.addOns)
    const dirsBefore = listDir(env.addOns).filter((n) => n !== WORK_DIR)
    const wtfBefore = snapshot(env.wtf)
    const parentBefore = listDir(path.dirname(env.addOns))
    const err = await installProduct(env.game, productById(productId)!, rel, ctx(env)).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    if (pattern) expect(err.message).toMatch(pattern)
    expect(snapshot(env.addOns)).toEqual(before)
    expect(listDir(env.addOns).filter((n) => n !== WORK_DIR)).toEqual(dirsBefore)
    expect(snapshot(env.wtf)).toEqual(wtfBefore)
    expect(listDir(path.dirname(env.addOns))).toEqual(parentBefore)
    noStaging(env)
    expect(fs.existsSync(path.join(env.addOns, '..', '..', 'evil.txt'))).toBe(false)
  }

  const evilNames = [
    '../evil.txt',
    'Spoken/../../evil.txt',
    '/evil.txt',
    'C:/evil.txt',
    'Spoken\\..\\..\\evil.txt',
    'Spoken/../../../evil.txt'
  ]
  for (const name of evilNames) {
    it(`rejects the zip-slip entry ${JSON.stringify(name)}`, async () => {
      const env = await setup()
      write(path.join(env.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
      await expectRefused(env, [...spokenEntries('9.9.9', ['Spoken']), { name, data: 'pwned' }])
      // The installed version is still the old one.
      expect(fs.readFileSync(path.join(env.addOns, 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')
    })
  }

  it('rejects a folder that is not in the allow list', async () => {
    const env = await setup()
    await expectRefused(env, [...spokenEntries('1.0.0', ['Spoken']), { name: 'Evil/Evil.toc', data: toc('Evil', '1') }], 'spoken', /may not install \(Evil\)/)
  })

  it('rejects a differently-cased folder name and a top-level file', async () => {
    const env = await setup()
    await expectRefused(env, [...spokenEntries('1.0.0', ['Spoken']), { name: 'spoken/Spoken.toc', data: 'x' }])
    await expectRefused(env, [...spokenEntries('1.0.0', ['Spoken']), { name: 'README.txt', data: 'x' }])
  })

  it('rejects a voice pack zip with a folder of Spoken in it, or with a missing folder', async () => {
    const env = await setup()
    await expectRefused(env, [{ name: 'SpokenPlacesAudio/a.ogg', data: 'x' }, { name: 'Spoken/Spoken.toc', data: toc('Spoken', '1') }], 'places-audio')
    await expectRefused(
      env,
      [{ name: 'SpokenQuestsAudioAlliance/a.ogg', data: 'x' }, { name: 'SpokenQuestsAudioHorde/a.ogg', data: 'x' }],
      'quests-audio',
      /expected folders/
    )
  })

  it('rejects a Spoken zip with no Spoken folder, or a folder with no toc', async () => {
    const env = await setup()
    await expectRefused(env, spokenEntries('1.0.0', ['Spoken_Places']), 'spoken', /no Spoken folder/)
    await expectRefused(env, [...spokenEntries('1.0.0', ['Spoken']), { name: 'Spoken_Places/a.lua', data: 'x' }], 'spoken', /Spoken_Places.toc is missing/)
  })

  it('rejects a damaged zip, and a download that is not a zip', async () => {
    const env = await setup()
    await expectRefused(env, Buffer.from('this is not a zip file at all, just text'), 'spoken', /damaged|unsafe/)
  })

  it('rejects an empty zip', async () => {
    const env = await setup()
    await expectRefused(env, [])
  })

  it('refuses before changing anything when a target is a junction (even the second one)', async () => {
    const env = await setup()
    const checkout = tmpDir()
    write(path.join(checkout, 'marker.lua'), 'dev work')
    fs.symlinkSync(checkout, path.join(env.addOns, 'Spoken_Places'), 'junction')
    write(path.join(env.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
    const zip = await yazlZip(spokenEntries('3.5.0'))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    const err = await installProduct(env.game, productById('spoken')!, rel, ctx(env)).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toBe('Spoken_Places: This folder is linked to a development checkout. The manager will not change it.')
    // Nothing moved: the real Spoken is still the old one, the junction is intact, no backup was made.
    expect(fs.readFileSync(path.join(env.addOns, 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')
    expect(fs.readFileSync(path.join(checkout, 'marker.lua'), 'utf8')).toBe('dev work')
    expect(fs.lstatSync(path.join(env.addOns, 'Spoken_Places')).isSymbolicLink()).toBe(true)
    expect(fs.existsSync(path.join(env.addOns, WORK_DIR, 'backup'))).toBe(false)
    expect(loadState(env.data).installs).toEqual({})
    noStaging(env)
  })

  it('refuses when the whole AddOns folder is a junction', async () => {
    const base = tmpDir()
    const game = await makeGame(base)
    const real = path.join(base, 'real-addons')
    fs.renameSync(game.addOnsPath, real)
    fs.symlinkSync(real, game.addOnsPath, 'junction')
    const env: Env = { data: tmpDir(), downloads: tmpDir(), game, addOns: game.addOnsPath, wtf: path.join(game.root, 'WTF') }
    const zip = await yazlZip(spokenEntries('3.5.0'))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    const err = await installProduct(game, productById('spoken')!, rel, ctx(env)).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/linked to a development checkout/)
    expect(fs.readdirSync(real)).toEqual([])
  })

  it('refuses a target that is a file', async () => {
    const env = await setup()
    write(path.join(env.addOns, 'Spoken'), 'a file')
    const zip = await yazlZip(spokenEntries('3.5.0', ['Spoken']))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    const err = await installProduct(env.game, productById('spoken')!, rel, ctx(env)).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(fs.readFileSync(path.join(env.addOns, 'Spoken'), 'utf8')).toBe('a file')
  })

  it('does not install when the download fails its digest', async () => {
    const env = await setup()
    const zip = await yazlZip(spokenEntries('3.5.0'))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip), { digest: `sha256:${'11'.repeat(32)}` })
    const err = await installProduct(env.game, productById('spoken')!, rel, ctx(env)).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/does not match/)
    expect(listDir(env.addOns)).toEqual([WORK_DIR].filter((n) => fs.existsSync(path.join(env.addOns, n))))
  })

  it('is cancelled before it starts when the signal is aborted', async () => {
    const env = await setup()
    const zip = await yazlZip(spokenEntries('3.5.0'))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    const controller = new AbortController()
    controller.abort()
    const err = await installProduct(env.game, productById('spoken')!, rel, ctx(env, { signal: controller.signal })).catch((e) => e)
    expect(isAbortError(err)).toBe(true)
    expect(server!.requests).toHaveLength(0)
  })

  it('refuses a game folder it cannot write to', async () => {
    const env = await setup()
    const zip = await yazlZip(spokenEntries('3.5.0'))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    // A file where the AddOns folder should be: nothing can be created below it.
    const base = tmpDir()
    write(path.join(base, 'World of Warcraft', '_retail_', 'Interface', 'AddOns'), 'file')
    const blocked: GameInstall = { ...env.game, root: path.join(base, 'World of Warcraft', '_retail_'), addOnsPath: path.join(base, 'World of Warcraft', '_retail_', 'Interface', 'AddOns') }
    const err = await installProduct(blocked, productById('spoken')!, rel, ctx(env)).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/cannot write to/)
  })
})

describe('installProduct: rollback', () => {
  it('puts every folder back when the second folder cannot be moved in', async () => {
    const env = await setup()
    write(path.join(env.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
    write(path.join(env.addOns, 'Spoken_Places', 'Spoken_Places.toc'), toc('Spoken_Places', '3.4.0'))
    write(path.join(env.addOns, 'Spoken_Places', 'keep.lua'), 'keep me')
    const before = snapshot(env.addOns)
    const wtfBefore = snapshot(env.wtf)

    const zip = await yazlZip(spokenEntries('3.5.0'))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    const c = ctx(env, {
      ops: {
        rename: async (from, to) => {
          if (from.includes(`${path.sep}staging${path.sep}`) && path.basename(to) === 'Spoken_Places') {
            throw Object.assign(new Error('disk on fire'), { code: 'EIO' })
          }
          await fs.promises.rename(from, to)
        }
      }
    })
    const err = await installProduct(env.game, productById('spoken')!, rel, c).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/Nothing was changed: disk on fire/)

    expect(snapshot(env.addOns)).toEqual(before)
    expect(snapshot(env.wtf)).toEqual(wtfBefore)
    expect(loadState(env.data).installs).toEqual({})
    noStaging(env)
    expect(c.events.at(-1)!.phase).not.toBe('done')
  })

  it('removes a folder that was new when a later one fails', async () => {
    const env = await setup()
    write(path.join(env.addOns, 'Spoken_Places', 'Spoken_Places.toc'), toc('Spoken_Places', '3.4.0'))
    const zip = await yazlZip(spokenEntries('3.5.0'))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    const c = ctx(env, {
      ops: {
        rename: async (from, to) => {
          if (from.includes(`${path.sep}staging${path.sep}`) && path.basename(to) === 'Spoken_Places') throw new Error('nope')
          await fs.promises.rename(from, to)
        }
      }
    })
    await expect(installProduct(env.game, productById('spoken')!, rel, c)).rejects.toBeInstanceOf(PlainError)
    expect(fs.existsSync(path.join(env.addOns, 'Spoken'))).toBe(false)
    expect(fs.readFileSync(path.join(env.addOns, 'Spoken_Places', 'Spoken_Places.toc'), 'utf8')).toContain('3.4.0')
  })

  it('names the backup when a rollback step fails too', async () => {
    const env = await setup()
    write(path.join(env.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))
    const zip = await yazlZip(spokenEntries('3.5.0', ['Spoken']))
    const rel = release('spoken', '3.5.0', zip, await serveZip(zip))
    const c = ctx(env, {
      ops: {
        rename: async (from, to) => {
          if (from.includes(`${path.sep}staging${path.sep}`)) throw new Error('first failure')
          if (from.includes(`${path.sep}backup${path.sep}`)) throw new Error('restore failure')
          await fs.promises.rename(from, to)
        }
      }
    })
    const err = await installProduct(env.game, productById('spoken')!, rel, c).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/could not put back Spoken/)
    expect(err.message).toContain(backupDirFor(env.game, 'spoken'))
    expect(fs.readFileSync(path.join(backupDirFor(env.game, 'spoken'), 'Spoken', 'Spoken.toc'), 'utf8')).toContain('3.4.0')
  })
})

describe('uninstallProduct', () => {
  async function installBoth(env: Env): Promise<void> {
    const z1 = await yazlZip(spokenEntries('3.5.0'))
    await installProduct(env.game, productById('spoken')!, release('spoken', '3.5.0', z1, await serveZip(z1)), ctx(env))
    await server!.close()
    const z2 = await yazlZip([{ name: 'SpokenPlacesAudio/SpokenPlacesAudio.toc', data: toc('SpokenPlacesAudio', '1.0.0') }, { name: 'SpokenPlacesAudio/a.ogg', data: 'ogg' }])
    await installProduct(env.game, productById('places-audio')!, release('places-audio', '1.0.0', z2, await serveZip(z2)), ctx(env))
  }

  it('removes exactly the recorded folders, keeps a backup and leaves everything else alone', async () => {
    const env = await setup()
    await installBoth(env)
    write(path.join(env.addOns, 'OtherAddon', 'OtherAddon.toc'), toc('OtherAddon', '1'))
    const wtfBefore = snapshot(env.wtf)
    const otherBefore = snapshot(path.join(env.addOns, 'OtherAddon'))
    const spokenBefore = snapshot(path.join(env.addOns, 'Spoken'))

    const c = ctx(env)
    const result = await uninstallProduct(env.game, productById('places-audio')!, c)
    expect(result.folders).toEqual(['SpokenPlacesAudio'])
    expect(fs.existsSync(path.join(env.addOns, 'SpokenPlacesAudio'))).toBe(false)
    expect(fs.existsSync(path.join(backupDirFor(env.game, 'places-audio'), 'SpokenPlacesAudio', 'a.ogg'))).toBe(true)
    expect(snapshot(path.join(env.addOns, 'Spoken'))).toEqual(spokenBefore)
    expect(snapshot(path.join(env.addOns, 'OtherAddon'))).toEqual(otherBefore)
    expect(snapshot(env.wtf)).toEqual(wtfBefore)
    expect(Object.keys(loadState(env.data).installs[env.game.id]!)).toEqual(['spoken'])
    expect(c.events.at(-1)).toMatchObject({ phase: 'done', action: 'uninstall' })
  })

  it('removes all of Spoken and nothing else', async () => {
    const env = await setup()
    await installBoth(env)
    write(path.join(env.addOns, 'OtherAddon', 'OtherAddon.toc'), toc('OtherAddon', '1'))
    await uninstallProduct(env.game, productById('spoken')!, ctx(env))
    expect(listDir(env.addOns)).toEqual([WORK_DIR, 'OtherAddon', 'SpokenPlacesAudio'].sort())
  })

  it('without a record uses the product folders, only real folders and only its own names', async () => {
    const env = await setup()
    write(path.join(env.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '1'))
    write(path.join(env.addOns, 'Spoken_Readables'), 'a file named like a folder')
    write(path.join(env.addOns, 'OtherAddon', 'OtherAddon.toc'), toc('OtherAddon', '1'))
    const result = await uninstallProduct(env.game, productById('spoken')!, ctx(env))
    expect(result.folders).toEqual(['Spoken'])
    expect(fs.readFileSync(path.join(env.addOns, 'Spoken_Readables'), 'utf8')).toBe('a file named like a folder')
    expect(fs.existsSync(path.join(env.addOns, 'OtherAddon'))).toBe(true)
  })

  it('ignores names in a tampered record that the product does not own', async () => {
    const env = await setup()
    await installBoth(env)
    const stateFile = path.join(env.data, 'state.json')
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    state.installs[env.game.id].spoken.folders = ['WTF', '..', 'Spoken', 'OtherAddon', '../WTF']
    fs.writeFileSync(stateFile, JSON.stringify(state))
    write(path.join(env.addOns, 'OtherAddon', 'OtherAddon.toc'), 'x')
    const wtfBefore = snapshot(env.wtf)
    const result = await uninstallProduct(env.game, productById('spoken')!, ctx(env))
    expect(result.folders).toEqual(['Spoken'])
    expect(fs.existsSync(path.join(env.addOns, 'OtherAddon'))).toBe(true)
    expect(snapshot(env.wtf)).toEqual(wtfBefore)
    expect(fs.existsSync(env.wtf)).toBe(true)
  })

  it('refuses the whole job when one folder is linked, and changes nothing', async () => {
    const env = await setup()
    await installBoth(env)
    fs.rmSync(path.join(env.addOns, 'Spoken_Places'), { recursive: true })
    const checkout = tmpDir()
    write(path.join(checkout, 'dev.lua'), 'dev')
    fs.symlinkSync(checkout, path.join(env.addOns, 'Spoken_Places'), 'junction')
    const before = snapshot(path.join(env.addOns, 'Spoken'))
    const err = await uninstallProduct(env.game, productById('spoken')!, ctx(env)).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/Spoken_Places: This folder is linked/)
    expect(snapshot(path.join(env.addOns, 'Spoken'))).toEqual(before)
    expect(fs.readFileSync(path.join(checkout, 'dev.lua'), 'utf8')).toBe('dev')
    expect(loadState(env.data).installs[env.game.id]!.spoken).toBeDefined()
  })

  it('says so when there is nothing to remove, and clears the record', async () => {
    const env = await setup()
    const c = ctx(env)
    const result = await uninstallProduct(env.game, productById('readables-audio')!, c)
    expect(result.folders).toEqual([])
    expect(result.message).toMatch(/Nothing to remove/)
  })
})


describe('installProduct: folders no longer in the zip', () => {
  async function installFolders(env: Env, version: string, folders: string[]) {
    const zip = await yazlZip(spokenEntries(version, folders))
    const rel = release('spoken', version, zip, await serveZip(zip))
    const c = ctx(env)
    const result = await installProduct(env.game, productById('spoken')!, rel, c)
    await server!.close()
    return result
  }

  it('moves a folder the manager recorded earlier to the backup, updates the record and says so', async () => {
    const env = await setup()
    await installFolders(env, '3.5.0', ['Spoken', 'Spoken_Quests'])
    write(path.join(env.addOns, 'Spoken_Places', 'Spoken_Places.toc'), toc('Spoken_Places', '1'))
    const placesBefore = snapshot(path.join(env.addOns, 'Spoken_Places'))
    const wtfBefore = snapshot(env.wtf)

    const result = await installFolders(env, '3.6.0', ['Spoken', 'Spoken_Conversations'])
    expect(result.removed).toEqual(['Spoken_Quests'])
    expect(result.message).toBe('Removed the old Spoken_Quests folder. Reload the game (/reload) or restart it to use it.')
    expect(fs.existsSync(path.join(env.addOns, 'Spoken_Quests'))).toBe(false)
    expect(fs.existsSync(path.join(backupDirFor(env.game, 'spoken'), 'Spoken_Quests', 'Spoken_Quests.toc'))).toBe(true)
    expect(listDir(env.addOns)).toEqual([WORK_DIR, 'Spoken', 'Spoken_Conversations', 'Spoken_Places'].sort())
    expect(loadState(env.data).installs[env.game.id]!.spoken!.folders).toEqual(['Spoken', 'Spoken_Conversations'])
    // Not recorded by the manager, so left alone; WTF too.
    expect(snapshot(path.join(env.addOns, 'Spoken_Places'))).toEqual(placesBefore)
    expect(snapshot(env.wtf)).toEqual(wtfBefore)
  })

  it('names several old folders', async () => {
    const env = await setup()
    await installFolders(env, '3.5.0', ['Spoken', 'Spoken_Quests', 'Spoken_Readables'])
    const result = await installFolders(env, '3.6.0', ['Spoken'])
    expect(result.removed.sort()).toEqual(['Spoken_Quests', 'Spoken_Readables'])
    expect(result.message).toMatch(/^Removed the old Spoken_Quests and Spoken_Readables folders\. /)
  })

  it('removes Spoken_NPCs once Spoken_Bosses replaces it', async () => {
    const env = await setup()
    await installFolders(env, '3.6.0', ['Spoken', 'Spoken_NPCs'])
    const result = await installFolders(env, '3.7.0', ['Spoken', 'Spoken_Bosses'])
    expect(result.removed).toEqual(['Spoken_NPCs'])
    expect(listDir(env.addOns)).toEqual([WORK_DIR, 'Spoken', 'Spoken_Bosses'].sort())
  })

  it('leaves a linked old folder alone', async () => {
    const env = await setup()
    await installFolders(env, '3.5.0', ['Spoken', 'Spoken_Quests'])
    fs.rmSync(path.join(env.addOns, 'Spoken_Quests'), { recursive: true })
    const checkout = tmpDir()
    write(path.join(checkout, 'dev.lua'), 'dev')
    fs.symlinkSync(checkout, path.join(env.addOns, 'Spoken_Quests'), 'junction')
    const result = await installFolders(env, '3.6.0', ['Spoken'])
    expect(result.removed).toEqual([])
    expect(result.message).not.toMatch(/Removed/)
    expect(fs.lstatSync(path.join(env.addOns, 'Spoken_Quests')).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(path.join(checkout, 'dev.lua'), 'utf8')).toBe('dev')
  })

  it('never removes a name in a tampered record that is not a plain folder name', async () => {
    const env = await setup()
    await installFolders(env, '3.5.0', ['Spoken'])
    const file = path.join(env.data, 'state.json')
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    state.installs[env.game.id].spoken.folders.push('WTF', '..', '../WTF', 'Interface')
    fs.writeFileSync(file, JSON.stringify(state))
    const wtfBefore = snapshot(env.wtf)
    const result = await installFolders(env, '3.6.0', ['Spoken'])
    expect(result.removed).toEqual([])
    expect(snapshot(env.wtf)).toEqual(wtfBefore)
  })

  it('rolls the old folder back with the rest when the install fails', async () => {
    const env = await setup()
    await installFolders(env, '3.5.0', ['Spoken', 'Spoken_Quests'])
    const before = snapshot(env.addOns)
    const zip = await yazlZip(spokenEntries('3.6.0', ['Spoken']))
    const rel = release('spoken', '3.6.0', zip, await serveZip(zip))
    const c = ctx(env, {
      ops: {
        rename: async (from, to) => {
          if (from.endsWith('Spoken_Quests')) throw new Error('locked')
          await fs.promises.rename(from, to)
        }
      }
    })
    await expect(installProduct(env.game, productById('spoken')!, rel, c)).rejects.toBeInstanceOf(PlainError)
    expect(snapshot(env.addOns)).toEqual(before)
  })
})

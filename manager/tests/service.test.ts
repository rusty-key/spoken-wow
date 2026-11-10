import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CHANNELS } from '../src/shared/api'
import type { Catalog, JobProgress } from '../src/shared/types'
import { ManagerService } from '../src/main/service'
import { loadSettings } from '../src/main/state'
import { makeGame, makeGameFolders, serveBuffer, sha256, startServer, tmpDir, toc, write, yazlZip, type TestServer } from './helpers'

let server: TestServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

async function setup() {
  const base = tmpDir()
  const game = await makeGame(base)
  const zip = await yazlZip([
    { name: 'Spoken/Spoken.toc', data: toc('Spoken', '3.5.0') },
    { name: 'Spoken/Spoken.lua', data: 'x' }
  ])
  server = await startServer((req, res) => serveBuffer(req, res, zip))
  const releases = [
    {
      tag_name: 'spoken/v3.5.0',
      draft: false,
      prerelease: false,
      published_at: '2026-10-01T00:00:00Z',
      body: 'Notes',
      html_url: 'https://github.com/rusty-key/spoken-wow/releases/tag/spoken/v3.5.0',
      assets: [{ name: 'Spoken-3.5.0.zip', size: zip.length, browser_download_url: `${server.url}/Spoken-3.5.0.zip`, digest: `sha256:${sha256(zip)}`, state: 'uploaded' }]
    },
    {
      tag_name: 'spoken/v3.6.0-beta.1',
      draft: false,
      prerelease: true,
      published_at: '2026-10-10T00:00:00Z',
      body: 'Beta',
      html_url: '',
      assets: [{ name: 'Spoken-3.6.0-beta.1.zip', size: 1, browser_download_url: `${server.url}/nope.zip` }]
    }
  ]
  let githubCalls = 0
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('https://api.github.com/')) {
      githubCalls++
      return new Response(JSON.stringify(releases), { status: 200, headers: { etag: '"x"', 'content-type': 'application/json' } })
    }
    return fetch(url, init)
  }) as unknown as typeof fetch
  const sent: { channel: string; payload: unknown }[] = []
  const data = tmpDir()
  const svc = new ManagerService({
    dataPath: data,
    appVersion: '0.1.0',
    packsBaseUrl: 'http://127.0.0.1:9/',
    send: (channel, payload) => sent.push({ channel, payload }),
    fetchImpl,
    autoPaths: [game.root],
    isRunning: async () => false,
    backoffMs: 1
  })
  await svc.init()
  return { svc, game, sent, data, githubCalls: () => githubCalls }
}

function waitFor(sent: { channel: string; payload: unknown }[], jobId: string): Promise<JobProgress> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const t = setInterval(() => {
      const last = sent.filter((s) => s.channel === CHANNELS.jobProgress && (s.payload as JobProgress).jobId === jobId).map((s) => s.payload as JobProgress).at(-1)
      if (last && ['done', 'error', 'cancelled'].includes(last.phase)) {
        clearInterval(t)
        resolve(last)
      } else if (Date.now() - started > 10000) {
        clearInterval(t)
        reject(new Error('timeout'))
      }
    }, 10)
  })
}

async function waitForJob(sent: { channel: string; payload: unknown }[], productId: string): Promise<string> {
  const started = Date.now()
  while (Date.now() - started <= 10000) {
    const job = sent
      .filter((s) => s.channel === CHANNELS.jobProgress)
      .map((s) => s.payload as JobProgress)
      .find((p) => p.productId === productId)
    if (job) return job.jobId
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${productId} job`)
}

describe('ManagerService', () => {
  it('scans, refreshes the catalog, reports statuses, installs and removes', async () => {
    const { svc, game, sent, data } = await setup()
    expect(svc.snapshot().games.map((g) => g.id)).toEqual([game.id])
    expect(svc.snapshot().dataPath).toBe(data)
    expect(sent.some((s) => s.channel === CHANNELS.gamesChanged)).toBe(true)

    const cat: Catalog = await svc.refreshCatalog(true)
    expect(cat.offline).toBe(false)
    expect(cat.releases.spoken!.map((r) => r.version)).toEqual(['3.6.0-beta.1', '3.5.0'])
    expect(sent.some((s) => s.channel === CHANNELS.catalogChanged)).toBe(true)
    expect(fs.existsSync(path.join(data, 'catalog.json'))).toBe(true)

    let spoken = (await svc.statuses(game.id)).find((s) => s.productId === 'spoken')!
    expect(spoken).toMatchObject({ state: 'not-installed', latest: { version: '3.5.0' } })

    const job = svc.install(game.id, 'spoken')
    const end = await waitFor(sent, job)
    expect(end).toMatchObject({ phase: 'done', version: '3.5.0', action: 'install' })

    spoken = (await svc.statuses(game.id)).find((s) => s.productId === 'spoken')!
    expect(spoken).toMatchObject({ state: 'up-to-date', installedVersion: '3.5.0', installedFolders: ['Spoken'] })

    const gone = await waitFor(sent, svc.uninstall(game.id, 'spoken'))
    expect(gone.phase).toBe('done')
    expect((await svc.statuses(game.id)).find((s) => s.productId === 'spoken')!.state).toBe('not-installed')
  })

  it('does not ask GitHub again within the cache window unless forced', async () => {
    const { svc, githubCalls } = await setup()
    await svc.refreshCatalog(true)
    await svc.refreshCatalog()
    await svc.refreshCatalog(false)
    expect(githubCalls()).toBe(1)
    await svc.refreshCatalog(true)
    expect(githubCalls()).toBe(2)
  })

  it('automatically updates installed official content when enabled', async () => {
    const { svc, game, sent } = await setup()
    fs.mkdirSync(path.join(game.addOnsPath, 'Spoken'), { recursive: true })
    fs.writeFileSync(path.join(game.addOnsPath, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.4.0'))

    svc.setSettings({ autoUpdateContent: true })
    await svc.refreshCatalog(true)

    const job = await waitForJob(sent, 'spoken')
    expect((await waitFor(sent, job)).phase).toBe('done')
    expect((await svc.statuses(game.id)).find((s) => s.productId === 'spoken')).toMatchObject({
      state: 'up-to-date',
      installedVersion: '3.5.0'
    })
  })

  it('turns "no release yet" and an unknown version into an error job, not a rejection', async () => {
    const { svc, game, sent } = await setup()
    const none = await waitFor(sent, svc.install(game.id, 'spoken'))
    expect(none.phase).toBe('error')
    expect(none.message).toMatch(/list of releases has not been loaded/)

    await svc.refreshCatalog(true)
    const missing = await waitFor(sent, svc.install(game.id, 'spoken', { version: '0.0.1' }))
    expect(missing).toMatchObject({ phase: 'error', message: 'Version 0.0.1 of Spoken is not in the list of releases.' })
    const noPack = await waitFor(sent, svc.install(game.id, 'places-audio'))
    expect(noPack.message).toBe('There is no release of Places voices to install yet.')
  })

  it('can install a named version, including a pre-release the list does not offer by default', async () => {
    const { svc, game, sent } = await setup()
    await svc.refreshCatalog(true)
    const job = svc.install(game.id, 'spoken', { version: '3.5.0' })
    expect((await waitFor(sent, job)).phase).toBe('done')
  })

  it('rejects unknown games and products', async () => {
    const { svc, game } = await setup()
    expect(() => svc.install('nope', 'spoken')).toThrow(/Unknown game/)
    expect(() => svc.install(game.id, 'nope')).toThrow(/Unknown product/)
    await expect(svc.statuses('nope')).rejects.toThrow(/Unknown game/)
  })

  it('keeps the last catalog and says offline when GitHub cannot be reached', async () => {
    const { svc, data } = await setup()
    await svc.refreshCatalog(true)
    const down = new ManagerService({
      dataPath: data,
      appVersion: '0.1.0',
      packsBaseUrl: 'http://127.0.0.1:9/',
      send: () => undefined,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch,
      autoPaths: []
    })
    expect(Object.keys(down.catalog.releases)).toEqual(['spoken'])
    const cat = await down.refreshCatalog(true)
    expect(cat.offline).toBe(true)
    expect(cat.error).toMatch(/Could not reach GitHub/)
    expect(cat.releases.spoken).toHaveLength(2)
  })

  it('adds and removes games and validates settings', async () => {
    const { svc, game } = await setup()
    const other = await makeGame(tmpDir(), { flavorFolder: '_anniversary_', product: 'wow_anniversary' })
    const res = await svc.addGame(other.root)
    expect(res.game?.id).toBe(other.id)
    expect(svc.games).toHaveLength(2)
    expect((await svc.addGame(tmpDir())).error).toMatch(/does not look like a World of Warcraft folder/)

    svc.setSettings({ lastGameId: other.id })
    expect(svc.removeGame(other.id).map((g) => g.id)).toEqual([game.id])
    expect(svc.settings.lastGameId).toBe('')

    expect(() => svc.setSettings({ downloadsPath: 'relative\path' })).toThrow(/full folder path/)
    const s = svc.setSettings({ includePrereleases: true, voiceLanguage: 'deDE' })
    expect(s).toMatchObject({ includePrereleases: true, downloadsPath: '', voiceLanguage: 'deDE' })
    expect(loadSettings(svc.dataPath).voiceLanguage).toBe('deDE')
    const abs = path.join(tmpDir(), 'dl')
    expect(svc.setSettings({ downloadsPath: abs }).downloadsPath).toBe(abs)
    expect(svc.downloadsPath()).toBe(abs)
  })

  it('never lists or adds a game Spoken does not run on; the install guard still refuses one that slipped in', async () => {
    const { svc, game, sent } = await setup()
    await svc.refreshCatalog(true)
    const retail = makeGameFolders(tmpDir(), { flavorFolder: '_retail_', product: 'wow' })
    const added = await svc.addGame(retail)
    expect(added.game).toBeUndefined()
    expect(added.error).toBe('Spoken runs on WoW: Forever, Classic Era and Anniversary. _retail_ is not one of them.')
    expect(svc.games.map((g) => g.id)).toEqual([game.id])

    // A second line of defence: a game of another flavor placed in the list is refused by install and uninstall.
    const odd = { ...game, id: 'oddgame00001', flavor: 'retail' as never, flavorFolder: '_retail_' }
    svc.games.push(odd)
    const refused = 'Spoken runs on WoW: Forever, Classic Era and Anniversary. _retail_ is not one of them.'
    expect(await waitFor(sent, svc.install(odd.id, 'spoken'))).toMatchObject({ phase: 'error', message: refused })
    expect(await waitFor(sent, svc.uninstall(odd.id, 'spoken'))).toMatchObject({ phase: 'error', message: refused })
  })

  it('treats Forever, Classic Era and Anniversary as supported', async () => {
    const { svc } = await setup()
    await svc.refreshCatalog(true)
    for (const [folder, product] of [['_classic_era_', 'wow_classic_era'], ['_anniversary_', 'wow_anniversary']] as const) {
      const g = await makeGame(tmpDir(), { flavorFolder: folder, product })
      const res = await svc.addGame(g.root)
      const spoken = (await svc.statuses(res.game!.id)).find((s) => s.productId === 'spoken')!
      expect(spoken.blockedReason).toBeUndefined()
      expect(spoken.state).toBe('not-installed')
    }
  })
})

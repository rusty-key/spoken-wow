import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHANNELS } from '../src/shared/api'
import type { GameInstall, SharingStatus } from '../src/shared/types'
import { ManagerService, SHARE_BACKOFF_MS } from '../src/main/service'
import { findContributionFiles, hashEnvelope, LEDGER_CAP, loadLedger, saveLedger, sendPending } from '../src/main/share'
import { loadSettings, sanitizeSettings } from '../src/main/state'
import { makeGame, tmpDir, write } from './helpers'

/** An envelope as the addon writes it; the manager never checks the sum, the site does. */
function envelope(n: number): string {
  return `!SPOKEN1 quests\naddon=SpokenQuests/3.5.0\nlocale=enUS\npack=enUS\nquest=${n}\nevent=accept\ntext<<\nLine ${n}.\n>>\nsum=1\n`
}

/** A SavedVariables file as the game writes it: each string with Lua's %q escapes. */
function savedVariables(envelopes: string[]): string {
  const lines = envelopes.map((e, i) => `\t\t{\n\t\t\t["key"] = "k${i}",\n\t\t\t["envelope"] = "${e.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}",\n\t\t},`)
  return `\nSpokenContributionsDB = {\n\t["Enabled"] = true,\n\t["Lines"] = {\n${lines.join('\n')}\n\t},\n}\n`
}

function contributionsFile(game: GameInstall, account: string, folder = 'SavedVariables', name = 'SpokenContributions.lua'): string {
  return path.join(game.root, 'WTF', 'Account', account, folder, name)
}

type Posted = { envelopes: string[]; installId: string }

/** A fetch that records each request and answers with the next status (200 once they run out). */
function fakeSite(statuses: number[] = []) {
  const posted: Posted[] = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)) as Posted)
    const status = statuses.shift() ?? 200
    return new Response(JSON.stringify({ ok: status === 200 }), { status })
  }) as unknown as typeof fetch
  return { posted, fetchImpl }
}

async function setup() {
  const base = tmpDir()
  const game = await makeGame(base)
  const dataPath = tmpDir()
  return { game, dataPath }
}

describe('findContributionFiles', () => {
  it('finds each account’s file whatever its case, and nothing else', async () => {
    const { game } = await setup()
    write(contributionsFile(game, 'ALPHA'), savedVariables([envelope(1)]))
    write(contributionsFile(game, 'BETA', 'savedvariables', 'spokencontributions.lua'), savedVariables([envelope(2)]))
    write(contributionsFile(game, 'GAMMA', 'SavedVariables', 'Spoken.lua'), 'SpokenSettings = {}')
    const files = await findContributionFiles(game)
    expect(files.map((f) => path.relative(game.root, f))).toEqual([
      path.join('WTF', 'Account', 'ALPHA', 'SavedVariables', 'SpokenContributions.lua'),
      path.join('WTF', 'Account', 'BETA', 'savedvariables', 'spokencontributions.lua')
    ])
  })

  it('skips a linked account folder', async () => {
    const { game } = await setup()
    const elsewhere = tmpDir()
    write(path.join(elsewhere, 'SavedVariables', 'SpokenContributions.lua'), savedVariables([envelope(1)]))
    fs.mkdirSync(path.join(game.root, 'WTF', 'Account'), { recursive: true })
    fs.symlinkSync(elsewhere, path.join(game.root, 'WTF', 'Account', 'LINKED'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await findContributionFiles(game)).toEqual([])
  })

  it('is empty for a game with no WTF folder', async () => {
    const { game } = await setup()
    expect(await findContributionFiles(game)).toEqual([])
  })
})

describe('sendPending', () => {
  it('sends each envelope once, across accounts, with a lasting install id', async () => {
    const { game, dataPath } = await setup()
    write(contributionsFile(game, 'A'), savedVariables([envelope(1), envelope(2)]))
    write(contributionsFile(game, 'B'), savedVariables([envelope(2), envelope(3)]))
    const site = fakeSite()

    const first = await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: site.fetchImpl })
    expect(first).toEqual({ outcome: 'sent', count: 3 })
    expect(site.posted).toHaveLength(1)
    expect(site.posted[0]!.envelopes).toEqual([envelope(1), envelope(2), envelope(3)])
    const id = site.posted[0]!.installId
    expect(id).toMatch(/^[0-9a-f-]{36}$/)

    // Unchanged files are not read again, and share.json is not rewritten.
    const ledgerFile = path.join(dataPath, 'share.json')
    fs.utimesSync(ledgerFile, 1, 1)
    expect(await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: site.fetchImpl })).toEqual({ outcome: 'nothing' })
    expect(fs.statSync(ledgerFile).mtimeMs).toBe(1000)

    // The game rewrites a file with one new line: only that one goes.
    write(contributionsFile(game, 'A'), savedVariables([envelope(1), envelope(2), envelope(4)]))
    expect(await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: site.fetchImpl })).toEqual({ outcome: 'sent', count: 1 })
    expect(site.posted[1]).toEqual({ envelopes: [envelope(4)], installId: id })
    expect(loadLedger(dataPath).lastSent?.count).toBe(1)
  })

  it('keeps nothing as sent when the site refuses, and sends it all on the next try', async () => {
    const { game, dataPath } = await setup()
    write(contributionsFile(game, 'A'), savedVariables([envelope(1), envelope(2)]))
    const site = fakeSite([500])
    expect(await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: site.fetchImpl })).toMatchObject({ outcome: 'failed', count: 0 })
    expect(Object.keys(loadLedger(dataPath).sent)).toEqual([])

    // The file has not changed, and is read again all the same.
    expect(await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: site.fetchImpl })).toEqual({ outcome: 'sent', count: 2 })
    expect(site.posted[0]!.installId).toBe(site.posted[1]!.installId)
  })

  it('stops on a 429 and keeps the chunks that went before it', async () => {
    const { game, dataPath } = await setup()
    const many = Array.from({ length: 2001 }, (_, i) => envelope(i))
    write(contributionsFile(game, 'A'), savedVariables(many))
    const site = fakeSite([200, 429])
    expect(await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: site.fetchImpl })).toEqual({ outcome: 'rate-limited', count: 2000 })
    expect(Object.keys(loadLedger(dataPath).sent)).toHaveLength(2000)
    expect(await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: site.fetchImpl })).toEqual({ outcome: 'sent', count: 1 })
    expect(site.posted[2]!.envelopes).toEqual([envelope(2000)])
  })

  it('sends the whole envelopes of a file cut short, and the cut one after the game writes it again', async () => {
    const { game, dataPath } = await setup()
    const full = savedVariables([envelope(1), envelope(2)])
    write(contributionsFile(game, 'A'), full.slice(0, full.indexOf('Line 2')))
    const site = fakeSite()
    expect(await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: site.fetchImpl })).toEqual({ outcome: 'sent', count: 1 })
    write(contributionsFile(game, 'A'), full)
    expect(await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: site.fetchImpl })).toEqual({ outcome: 'sent', count: 1 })
    expect(site.posted[1]!.envelopes).toEqual([envelope(2)])
  })

  it('forgets the oldest hashes past the cap', async () => {
    const { game, dataPath } = await setup()
    const ledger = loadLedger(dataPath)
    for (let i = 0; i < LEDGER_CAP; i++) ledger.sent[`old${i}`] = '2026-01-01T00:00:00Z'
    saveLedger(dataPath, ledger)
    write(contributionsFile(game, 'A'), savedVariables([envelope(1)]))
    await sendPending({ dataPath, games: [game], appVersion: '0.1.0', fetchImpl: fakeSite().fetchImpl })
    const sent = loadLedger(dataPath).sent
    expect(Object.keys(sent)).toHaveLength(LEDGER_CAP)
    expect(sent.old0).toBeUndefined()
    expect(sent[hashEnvelope(envelope(1))]).toBeDefined()
  })
})

describe('sharing settings', () => {
  it("starts unset, and an unknown stored value is read as unset", () => {
    expect(sanitizeSettings({}).sharing).toBe('unset')
    expect(sanitizeSettings({ sharing: 'yes please' }).sharing).toBe('unset')
    expect(sanitizeSettings({ sharing: 'off' }).sharing).toBe('off')
  })
})

describe('ManagerService sharing', () => {
  async function service(statuses: number[] = []) {
    const { game, dataPath } = await setup()
    const site = fakeSite(statuses)
    const sent: { channel: string; payload: unknown }[] = []
    const svc = new ManagerService({
      dataPath,
      appVersion: '0.1.0',
      packsBaseUrl: 'http://127.0.0.1:9/',
      send: (channel, payload) => sent.push({ channel, payload }),
      fetchImpl: site.fetchImpl,
      autoPaths: [game.root]
    })
    await svc.init()
    return { svc, game, dataPath, site, sent }
  }

  it('sends nothing until the player says yes, then sends at once', async () => {
    const { svc, game, dataPath, site, sent } = await service()
    write(contributionsFile(game, 'A'), savedVariables([envelope(1)]))
    expect(await svc.shareTick(true)).toBeNull()
    await expect(svc.sendNow()).rejects.toThrow('Turn on Sharing first.')
    expect(site.posted).toHaveLength(0)

    svc.setSettings({ sharing: 'on' })
    expect(loadSettings(dataPath).sharing).toBe('on')
    await svc.sendNow()
    expect(site.posted).toHaveLength(1)
    const last = sent.filter((s) => s.channel === CHANNELS.sharingChanged).at(-1)?.payload as SharingStatus
    expect(last).toMatchObject({ sending: false, lastSent: { count: 1 } })
    expect(svc.snapshot().sharingStatus?.lastSent?.count).toBe(1)
  })

  it('waits after a failure, and Send Now does not', async () => {
    const { svc, game, site } = await service([500, 500])
    write(contributionsFile(game, 'A'), savedVariables([envelope(1)]))
    svc.setSettings({ sharing: 'on' })
    await svc.sendNow()
    expect(svc.sharingStatus.error).toBe('The site answered 500.')
    const posts = site.posted.length
    expect(await svc.shareTick(false)).toBeNull()
    expect(site.posted).toHaveLength(posts)
    await svc.sendNow()
    expect(site.posted.length).toBeGreaterThan(posts)
    expect(SHARE_BACKOFF_MS[0]).toBe(60 * 1000)
  })

  it('stops a send when the player turns sharing off', async () => {
    const { game, dataPath } = await setup()
    write(contributionsFile(game, 'A'), savedVariables([envelope(1)]))
    let release: () => void = () => undefined
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        release = () => resolve(new Response('{}', { status: 200 }))
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })) as unknown as typeof fetch
    const svc = new ManagerService({ dataPath, appVersion: '0.1.0', packsBaseUrl: 'http://127.0.0.1:9/', send: () => undefined, fetchImpl, autoPaths: [game.root] })
    await svc.init()
    svc.settings = { ...svc.settings, sharing: 'on' }
    const running = svc.shareTick(true)
    await new Promise((r) => setTimeout(r, 20))
    svc.setSettings({ sharing: 'off' })
    expect(await running).toBeNull()
    release()
    expect(Object.keys(loadLedger(dataPath).sent)).toEqual([])
  })
})

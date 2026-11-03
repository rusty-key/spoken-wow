import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHANNELS } from '../src/shared/api'
import type { GameInstall, JobProgress } from '../src/shared/types'
import { cleanContributorTmp } from '../src/main/cleanup'
import { ContributorStore, type SecretBox } from '../src/main/contributor-store'
import { languageFolders } from '../src/main/contributor-status'
import { savePackState } from '../src/main/packs-state'
import { ManagerService } from '../src/main/service'
import { makeGame, tmpDir, write } from './helpers'

const SITE = 'https://site.test'
const PASSWORD = 'hunter2-password'
const CF_TOKEN = 'cf-secret-token'
const GH_TOKEN = 'gh-secret-token'
const COOKIE_VALUE = 'cookie-secret-value'
const COOKIE = `__Secure-better-auth.session_token=${COOKIE_VALUE}`
const DE = languageFolders('deDE')
const PLACES = 'SpokenPlacesAudio_deDE'
const READABLES = 'SpokenReadablesAudio_deDE'
const BOSSES = 'SpokenBossesAudio_deDE'

function fakeBox(available = true): SecretBox {
  return {
    available: () => available,
    seal: (s) => `sealed:${Buffer.from(s).toString('base64')}`,
    open: (s) => Buffer.from(s.slice('sealed:'.length), 'base64').toString()
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

interface Call {
  url: string
  init: RequestInit
  headers: Headers
}

type Route = (call: Call) => Response | undefined | Promise<Response | undefined>

interface Options {
  box?: SecretBox
  adminLangs?: string[]
  route?: Route
}

async function setup(o: Options = {}) {
  const dir = tmpDir()
  const game = await makeGame(tmpDir())
  const calls: Call[] = []
  const events: Array<{ channel: string; payload: unknown }> = []
  const site = { accountStatus: 200, adminLangs: o.adminLangs ?? ['deDE'], down: false }
  const box = o.box ?? fakeBox()

  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = { url: String(input), init, headers: new Headers(init.headers) }
    calls.push(call)
    const custom = await o.route?.(call)
    if (custom) return custom
    if (call.url.startsWith(SITE) && site.down) throw new Error(`refused ${call.headers.get('cookie') ?? ''}`)
    if (call.url === `${SITE}/api/auth/sign-in/email`) {
      const headers = new Headers({ 'content-type': 'application/json' })
      headers.append('set-cookie', `${COOKIE}; Path=/; HttpOnly; Secure; SameSite=Lax`)
      headers.append('set-cookie', 'other=2; Path=/')
      headers.append('set-cookie', 'gone=; Max-Age=0; Path=/')
      return new Response('{"user":{}}', { status: 200, headers })
    }
    if (call.url === `${SITE}/api/auth/sign-out`) return json({ success: true })
    if (call.url === `${SITE}/api/manager/contributor`) {
      if (site.accountStatus !== 200) return json({ error: 'signed out' }, site.accountStatus)
      return json({ email: 'me@example.test', adminLangs: site.adminLangs })
    }
    if (call.url === 'https://wow.curseforge.com/api/game/versions') {
      return json([
        { id: 1, name: '1.15.9' },
        { id: 2, name: '2.5.6' },
        { id: 3, name: '1.60.1' }
      ])
    }
    const widget = /api\.cfwidget\.com\/(\d+)/.exec(call.url)
    if (widget) return json({ files: [] })
    throw new Error(`unexpected request ${call.url}`)
  }) as typeof fetch

  const svc = new ManagerService({
    dataPath: dir,
    appVersion: '1.0.0',
    send: (channel, payload) => events.push({ channel, payload }),
    fetchImpl,
    autoPaths: [],
    siteUrl: SITE,
    secretBox: box
  })
  svc.games = [game]
  svc.channel = { generatedAt: '2026-11-01T00:00:00.000Z', packs: {} }
  const store = new ContributorStore(dir, box)

  const install = (folder: string, version = '1.2.0', rev = 'r1', title = `|cFF00FF00${folder}|r voices`): void => {
    write(path.join(game.addOnsPath, folder, `${folder}.toc`), `## Title: ${title}\n## Version: ${version}\n`)
    write(path.join(game.addOnsPath, folder, 'sounds', 'a.ogg'), 'clip')
    savePackState(game, { packId: folder, rev, files: {} })
    svc.channel!.packs[folder] = { rev, manifestSha256: 'x', fileCount: 1, totalSize: 1, requires: { Spoken: '>=3.0.0' } }
  }

  const jobs = (): JobProgress[] => events.filter((e) => e.channel === CHANNELS.jobProgress).map((e) => e.payload as JobProgress)
  const finished = async (jobId: string): Promise<JobProgress> => {
    for (let i = 0; i < 2000; i++) {
      const end = jobs().find((j) => j.jobId === jobId && ['done', 'error', 'cancelled'].includes(j.phase))
      if (end) return end
      await new Promise((r) => setTimeout(r, 5))
    }
    throw new Error('the job did not end')
  }

  return { dir, game: game as GameInstall, svc, store, calls, events, site, install, jobs, finished }
}

type Harness = Awaited<ReturnType<typeof setup>>

async function signedIn(o: Options = {}): Promise<Harness> {
  const h = await setup(o)
  await h.svc.contributor.signIn('me@example.test', PASSWORD)
  return h
}

/** Everything the manager wrote under its data folder. */
function allText(dir: string): string {
  let out = ''
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    out += entry.isDirectory() ? allText(full) : fs.readFileSync(full, 'utf8')
  }
  return out
}

function cfUpload(onUpload?: (project: string, call: Call) => ReturnType<Route>): Route {
  return async (call) => {
    const m = /\/api\/projects\/(\d+)\/upload-file$/.exec(call.url)
    if (!m) return undefined
    const answer = await onUpload?.(m[1]!, call)
    if (answer) return answer
    const body = await new Response(call.init.body as BodyInit).text()
    expect(body).toContain('"changelogType":"markdown"')
    return json({ id: Number(m[1]) + 1000 })
  }
}

function configureCf(h: Harness, projects: Record<string, string>): void {
  h.store.setToken('curseforge', CF_TOKEN)
  h.store.saveConfig({ projects })
}

describe('signing in', () => {
  it('signIn sends no password anywhere but the site, stores the cookie and keeps no password in contributor.json', async () => {
    const h = await setup()
    const view = await h.svc.contributor.signIn(' me@example.test ', PASSWORD)
    expect(view.account).toEqual({ email: 'me@example.test', adminLangs: ['deDE'] })

    const signIn = h.calls.find((c) => c.url.endsWith('/api/auth/sign-in/email'))!
    expect(signIn.init.method).toBe('POST')
    expect(signIn.headers.get('origin')).toBe(SITE)
    expect(signIn.init.redirect).toBe('error')
    expect(JSON.parse(String(signIn.init.body))).toEqual({ email: 'me@example.test', password: PASSWORD })
    for (const c of h.calls) {
      if (c !== signIn) expect(String(c.init.body ?? '')).not.toContain(PASSWORD)
      expect(c.url.startsWith(`${SITE}/`)).toBe(true)
    }

    const asked = h.calls.find((c) => c.url.endsWith('/api/manager/contributor'))!
    expect(asked.headers.get('cookie')).toBe(`${COOKIE}; other=2`)
    expect(h.store.cookie()).toBe(`${COOKIE}; other=2`)
    const onDisk = allText(h.dir)
    expect(onDisk).not.toContain(PASSWORD)
    expect(onDisk).not.toContain(COOKIE_VALUE)
    expect(JSON.stringify(view)).not.toContain(COOKIE_VALUE)
  })

  it('the site and the stores go through contributorFetch when one is given', async () => {
    const asked: string[] = []
    const agents: Array<string | null> = []
    const svc = new ManagerService({
      dataPath: tmpDir(),
      appVersion: '1.0.0',
      send: () => undefined,
      fetchImpl: (() => Promise.reject(new Error('the wrong fetch'))) as typeof fetch,
      contributorFetch: (async (url: string, init?: RequestInit) => {
        asked.push(url)
        agents.push(new Headers(init?.headers).get('user-agent'))
        return json({ error: 'wrong' }, 401)
      }) as typeof fetch,
      siteUrl: SITE,
      secretBox: fakeBox()
    })
    await expect(svc.contributor.signIn('me@example.test', PASSWORD)).rejects.toThrow(/not right/)
    expect(asked).toEqual([`${SITE}/api/auth/sign-in/email`])
    expect(agents).toEqual(['SpokenManager/1.0.0'])
  })

  it('a wrong password says so and keeps nothing', async () => {
    const h = await setup({ route: (c) => (c.url.endsWith('/sign-in/email') ? json({ message: `bad ${PASSWORD}` }, 401) : undefined) })
    const err = await h.svc.contributor.signIn('me@example.test', PASSWORD).catch((e: Error) => e)
    expect((err as Error).name).toBe('PlainError')
    expect((err as Error).message).not.toContain(PASSWORD)
    expect(h.store.cookie()).toBeNull()
  })

  it('a failed request never carries the password into the error', async () => {
    const h = await setup({
      route: (c) => {
        if (c.url.endsWith('/sign-in/email')) throw new Error(`socket closed: ${String(c.init.body)}`)
        return undefined
      }
    })
    const err = (await h.svc.contributor.signIn('me@example.test', PASSWORD).catch((e: Error) => e)) as Error
    expect(err.name).toBe('PlainError')
    expect(err.message).not.toContain(PASSWORD)
  })

  it('a computer that cannot keep secrets refuses before the password leaves it', async () => {
    const h = await setup({ box: fakeBox(false) })
    await expect(h.svc.contributor.signIn('me@example.test', PASSWORD)).rejects.toThrow(/cannot keep secrets/)
    expect(h.calls).toEqual([])
    expect((await h.svc.contributor.view()).canStoreSecrets).toBe(false)
  })

  it('a 401 from the site clears the session, keeps tokens and ids, and view() returns account null', async () => {
    const h = await signedIn()
    configureCf(h, { [PLACES]: '123' })
    h.site.accountStatus = 401
    const view = await h.svc.contributor.view()
    expect(view.account).toBeNull()
    expect(view.config.projects).toEqual({ [PLACES]: '123' })
    expect(view.config.hasCfToken).toBe(true)
    expect(h.store.cookie()).toBeNull()
    expect(h.store.token('curseforge')).toBe(CF_TOKEN)
  })

  it('a 401 found while reading rows or publishing tells the window', async () => {
    const h = await signedIn()
    h.site.accountStatus = 401
    await expect(h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')).rejects.toThrow(/Sign in/)
    const changed = h.events.filter((e) => e.channel === CHANNELS.contributorChanged)
    expect(changed).toHaveLength(1)
    expect(changed[0]!.payload).toMatchObject({ account: null })
    expect(h.store.cookie()).toBeNull()
  })

  it('a sign-in the site cannot confirm keeps neither the cookie nor an earlier account', async () => {
    let siteAnswers = true
    const h = await signedIn({
      route: (c) => {
        if (c.url.endsWith('/api/manager/contributor') && !siteAnswers) throw new Error('down')
        return undefined
      }
    })
    siteAnswers = false
    await expect(h.svc.contributor.signIn('other@example.test', PASSWORD)).rejects.toThrow(/did not confirm/)
    expect(h.store.cookie()).toBeNull()
    expect((await h.svc.contributor.view()).account).toBeNull()
  })

  it('a site that cannot be reached keeps the session and the account already known', async () => {
    const h = await signedIn()
    h.site.down = true
    const view = await h.svc.contributor.view()
    expect(view.account?.email).toBe('me@example.test')
    expect(h.store.cookie()).not.toBeNull()
  })

  it('an account with no admin languages still returns its account, so the window can say so', async () => {
    const h = await signedIn({ adminLangs: [] })
    expect((await h.svc.contributor.view()).account).toEqual({ email: 'me@example.test', adminLangs: [] })
  })

  it('signOut clears the stored cookie even when the site cannot be told', async () => {
    const h = await signedIn({ route: (c) => (c.url.endsWith('/sign-out') ? Promise.reject(new Error('down')) : undefined) })
    configureCf(h, { [PLACES]: '123' })
    const view = await h.svc.contributor.signOut()
    expect(view.account).toBeNull()
    expect(h.store.cookie()).toBeNull()
    expect(h.store.token('curseforge')).toBe(CF_TOKEN)
    const out = h.calls.find((c) => c.url.endsWith('/sign-out'))!
    expect(out.headers.get('origin')).toBe(SITE)
  })
})

describe('rows', () => {
  it('rows refuses a language the account does not administer', async () => {
    const h = await signedIn()
    await expect(h.svc.contributor.rows(h.game.id, 'frFR', 'curseforge')).rejects.toThrow(/frFR/)
  })

  it('rows refuses when nobody is signed in', async () => {
    const h = await setup()
    await expect(h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')).rejects.toThrow(/Sign in/)
  })

  it('lists every folder of the language, with an uninstalled one as not-installed', async () => {
    const h = await signedIn()
    const rows = await h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')
    expect(rows.map((r) => r.folder)).toEqual(DE)
    expect(rows.every((r) => r.state === 'not-installed')).toBe(true)
  })

  it('rows marks a folder update-first when its pack state rev differs from the channel\'s', async () => {
    const h = await signedIn()
    h.install(PLACES)
    configureCf(h, { [PLACES]: '123' })
    h.svc.channel!.packs[PLACES]!.rev = 'r2'
    const rows = await h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')
    expect(rows.find((r) => r.folder === PLACES)).toMatchObject({ version: '1.2.0', state: 'update-first' })
  })

  it('a folder that cannot be confirmed current on the channel is update-first', async () => {
    const h = await signedIn()
    h.install(PLACES)
    h.install(READABLES)
    configureCf(h, { [PLACES]: '123', [READABLES]: '124' })
    delete h.svc.channel!.packs[PLACES]
    let rows = await h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')
    expect(rows.find((r) => r.folder === PLACES)?.state).toBe('update-first')
    expect(rows.find((r) => r.folder === READABLES)?.state).toBe('unreleased')
    h.svc.channel = null
    rows = await h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')
    expect(rows.find((r) => r.folder === READABLES)?.state).toBe('update-first')
  })

  it('rows marks a linked folder linked', async () => {
    const h = await signedIn()
    h.install(PLACES)
    const real = path.join(tmpDir(), PLACES)
    fs.renameSync(path.join(h.game.addOnsPath, PLACES), real)
    fs.symlinkSync(real, path.join(h.game.addOnsPath, PLACES))
    const rows = await h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')
    expect(rows.find((r) => r.folder === PLACES)?.state).toBe('linked')
  })

  it('every installed folder is linked when the AddOns folder is a link', async () => {
    const h = await signedIn()
    h.install(PLACES)
    const real = path.join(tmpDir(), 'AddOns')
    fs.renameSync(h.game.addOnsPath, real)
    fs.symlinkSync(real, h.game.addOnsPath)
    const rows = await h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')
    expect(rows.find((r) => r.folder === PLACES)?.state).toBe('linked')
  })

  it('a CurseForge row reads its project by folder and counts recorded uploads as awaiting', async () => {
    const h = await signedIn()
    h.install(PLACES)
    h.install(READABLES)
    h.install(BOSSES)
    configureCf(h, { [PLACES]: '123', [READABLES]: '124' })
    h.store.recordUpload({ store: 'curseforge', folder: READABLES, version: '1.2.0', fileId: '9', at: 'now' })
    const rows = await h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')
    expect(rows.find((r) => r.folder === PLACES)).toMatchObject({ state: 'unreleased', project: '123' })
    expect(rows.find((r) => r.folder === READABLES)).toMatchObject({ state: 'awaiting', project: '124' })
    expect(rows.find((r) => r.folder === BOSSES)?.state).toBe('no-project')
  })

  it('a GitHub row has no awaiting state', async () => {
    const h = await signedIn({
      route: (c) => {
        const m = /\/releases\/tags\/(.+)$/.exec(c.url)
        if (!m) return undefined
        const folder = decodeURIComponent(m[1]!).split('/')[0]!
        if (folder === PLACES) return json({ assets: [{ name: `${PLACES}-1.2.0.zip` }] })
        if (folder === READABLES) return new Response('', { status: 404 })
        return new Response('', { status: 500 })
      }
    })
    h.install(PLACES)
    h.install(READABLES)
    h.install(BOSSES)
    h.store.setToken('github', GH_TOKEN)
    h.store.saveConfig({ repo: 'me/packs' })
    // A record says nothing on GitHub, where a release shows at once.
    h.store.recordUpload({ store: 'github', folder: READABLES, version: '1.2.0', fileId: null, at: 'now' })
    const rows = await h.svc.contributor.rows(h.game.id, 'deDE', 'github')
    expect(rows.find((r) => r.folder === PLACES)).toMatchObject({ state: 'live', link: `https://github.com/me/packs/releases/tag/${PLACES}/v1.2.0` })
    expect(rows.find((r) => r.folder === READABLES)?.state).toBe('unreleased')
    expect(rows.find((r) => r.folder === BOSSES)?.state).toBe('unchecked')
  })

  it('a GitHub row cannot be judged without a token and a repository', async () => {
    const h = await signedIn()
    h.install(PLACES)
    const rows = await h.svc.contributor.rows(h.game.id, 'deDE', 'github')
    expect(rows.find((r) => r.folder === PLACES)?.state).toBe('unchecked')
  })
})

describe('saveStore', () => {
  it('saveStore checks a new token before keeping it, and a failed check saves nothing', async () => {
    let accepted = false
    const h = await signedIn({
      route: (c) => {
        if (c.url.endsWith('/game/versions')) {
          expect(c.headers.get('x-api-token')).toBe(CF_TOKEN)
          return accepted ? json([]) : json({}, 401)
        }
        if (c.url === 'https://api.github.com/repos/me/packs') {
          expect(c.headers.get('authorization')).toBe(`Bearer ${GH_TOKEN}`)
          return json({ permissions: { push: accepted } })
        }
        return undefined
      }
    })

    await expect(h.svc.contributor.saveStore({ store: 'curseforge', token: CF_TOKEN, projects: { [PLACES]: '5' } })).rejects.toThrow(/did not accept/)
    await expect(h.svc.contributor.saveStore({ store: 'github', token: GH_TOKEN, repo: 'me/packs' })).rejects.toThrow(/cannot push/)
    let view = await h.svc.contributor.view()
    expect(view.config).toMatchObject({ hasCfToken: false, hasGhToken: false, projects: {}, repo: '' })

    accepted = true
    view = await h.svc.contributor.saveStore({ store: 'curseforge', token: CF_TOKEN, projects: { [PLACES]: '5' } })
    expect(view.config).toMatchObject({ hasCfToken: true, projects: { [PLACES]: '5' } })
    view = await h.svc.contributor.saveStore({ store: 'github', token: GH_TOKEN, repo: 'me/packs' })
    expect(view.config).toMatchObject({ hasGhToken: true, repo: 'me/packs' })
    expect(allText(h.dir)).not.toContain(CF_TOKEN)
    expect(allText(h.dir)).not.toContain(GH_TOKEN)
    expect(JSON.stringify(view)).not.toContain(GH_TOKEN)
  })

  it('a bad project id saves no token that passed its check', async () => {
    const h = await signedIn({ route: (c) => (c.url.endsWith('/game/versions') ? json([]) : undefined) })
    await expect(h.svc.contributor.saveStore({ store: 'curseforge', token: CF_TOKEN, projects: { [PLACES]: 'abc' } })).rejects.toThrow(/digits/)
    expect(h.store.token('curseforge')).toBeNull()
  })

  it('an empty token forgets the stored one with no check, and settings alone are not checked', async () => {
    const h = await signedIn()
    h.store.setToken('curseforge', CF_TOKEN)
    await h.svc.contributor.saveStore({ store: 'curseforge', gameVersions: '1.15.9' })
    expect(h.store.token('curseforge')).toBe(CF_TOKEN)
    const view = await h.svc.contributor.saveStore({ store: 'curseforge', token: '' })
    expect(view.config.hasCfToken).toBe(false)
    expect(view.config.gameVersions).toBe('1.15.9')
    expect(h.calls.some((c) => c.url.includes('curseforge.com'))).toBe(false)
  })

  it('a new repository is checked against the token already saved', async () => {
    const h = await signedIn({ route: (c) => (c.url === 'https://api.github.com/repos/me/other' ? json({ permissions: { push: false } }) : undefined) })
    h.store.setToken('github', GH_TOKEN)
    await expect(h.svc.contributor.saveStore({ store: 'github', repo: 'me/other' })).rejects.toThrow(/cannot push/)
    expect(h.store.config().repo).toBe('')
  })

  it('a token cannot be saved on a computer that cannot keep secrets, and is never sent to be checked', async () => {
    const h = await setup({ box: fakeBox(false) })
    await expect(h.svc.contributor.saveStore({ store: 'curseforge', token: CF_TOKEN })).rejects.toThrow(/cannot keep secrets/)
    expect(h.calls.some((c) => c.url.includes('curseforge.com'))).toBe(false)
  })
})

describe('publish', () => {
  it('publish uploads only Unreleased rows, records each upload as it finishes, and reports published, skipped and failed', async () => {
    let harness: Harness | null = null
    const seen: Array<{ project: string; recorded: string[]; changelog: string; zips: number }> = []
    const h = await signedIn({
      route: cfUpload(async (project, call) => {
        const text = await new Response(call.init.body as BodyInit).text()
        const h = harness!
        seen.push({
          project,
          recorded: h.store.uploads('curseforge').map((u) => u.folder),
          changelog: /"changelog":"([^"]*)"/.exec(text)![1]!,
          zips: fs.readdirSync(path.join(h.dir, 'contributor-tmp')).length
        })
        if (project === '200') return json({ errorMessage: `rejected ${CF_TOKEN}` }, 422)
        return json({ id: Number(project) + 1000 })
      })
    })
    harness = h
    const quests = 'SpokenQuestsAudioHorde_deDE'
    h.install(PLACES) // unreleased, published
    h.install(READABLES) // unreleased, fails
    h.install(BOSSES) // no project
    h.install(quests)
    configureCf(h, { [PLACES]: '100', [READABLES]: '200', [quests]: '300' })
    h.store.recordUpload({ store: 'curseforge', folder: quests, version: '1.2.0', fileId: '1', at: 'now' }) // awaiting

    const jobId = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    const end = await h.finished(jobId)
    expect(end.phase).toBe('done')

    expect(seen.map((s) => s.project)).toEqual(['100', '200'])
    expect(seen.find((s) => s.project === '200')?.recorded).toContain(PLACES)
    expect(seen.find((s) => s.project === '100')?.changelog).toBe(`${PLACES} voices 1.2.0`)
    expect(seen.every((s) => s.zips === 1)).toBe(true)

    const { lastRun } = await h.svc.contributor.view()
    expect(lastRun).toMatchObject({ store: 'curseforge', stoppedEarly: false })
    expect(lastRun!.published).toEqual([{ folder: PLACES, version: '1.2.0', link: 'https://www.curseforge.com/projects/100' }])
    expect(lastRun!.failed.map((f) => f.folder)).toEqual([READABLES])
    expect(lastRun!.failed[0]!.reason).toContain('422')
    expect(lastRun!.failed[0]!.reason).not.toContain(CF_TOKEN)
    expect(lastRun!.skipped.sort()).toEqual(DE.filter((f) => f !== PLACES && f !== READABLES).sort())

    expect(h.store.uploads('curseforge').map((u) => [u.folder, u.fileId])).toEqual([
      [quests, '1'],
      [PLACES, '1100']
    ])
    expect(fs.readdirSync(path.join(h.dir, 'contributor-tmp'))).toEqual([])
    const messages = h.jobs().filter((j) => j.jobId === jobId).map((j) => j.message)
    expect(messages).toContain(`1/2 ${PLACES}: zipping`)
    expect(messages).toContain(`1/2 ${PLACES}: uploading`)
    expect(messages).toContain(`2/2 ${READABLES}: uploading`)
    const step = h.jobs().find((j) => j.message === `2/2 ${READABLES}: uploading`)!
    expect(step).toMatchObject({ gameId: h.game.id, productId: 'publish/curseforge', action: 'publish', received: 2, total: 2 })
    const changed = h.events.filter((e) => e.channel === CHANNELS.contributorChanged)
    expect(changed).toHaveLength(1)
    expect(changed[0]!.payload).toMatchObject({ lastRun: { store: 'curseforge' } })
    expect(JSON.stringify(changed[0]!.payload)).not.toContain(COOKIE_VALUE)
  })

  it('records each upload the moment it finishes', async () => {
    let harness: Harness | null = null
    let recordedAtSecond: string[] | null = null
    const h = await signedIn({
      route: cfUpload((project) => {
        if (project !== '200') return undefined
        recordedAtSecond = harness!.store.uploads('curseforge').map((u) => u.folder)
        return json({ id: 2 })
      })
    })
    harness = h
    h.install(PLACES)
    h.install(READABLES)
    configureCf(h, { [PLACES]: '100', [READABLES]: '200' })
    await h.finished(await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge'))
    expect(recordedAtSecond).toEqual([PLACES])
  })

  it('a failed pack does not stop the rest', async () => {
    const h = await signedIn({ route: cfUpload((project) => (project === '100' ? json({}, 500) : undefined)) })
    h.install(PLACES)
    h.install(READABLES)
    configureCf(h, { [PLACES]: '100', [READABLES]: '200' })
    const jobId = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    expect((await h.finished(jobId)).phase).toBe('done')
    const { lastRun } = await h.svc.contributor.view()
    expect(lastRun!.failed.map((f) => f.folder)).toEqual([PLACES])
    expect(lastRun!.published.map((p) => p.folder)).toEqual([READABLES])
    expect(lastRun!.stoppedEarly).toBe(false)
  })

  it('an unresolved game version fails the run before any zip is made', async () => {
    const h = await signedIn({ route: cfUpload() })
    h.install(PLACES)
    configureCf(h, { [PLACES]: '100' })
    h.store.saveConfig({ gameVersions: '9.9.9' })
    const jobId = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    const end = await h.finished(jobId)
    expect(end.phase).toBe('error')
    expect(end.message).toMatch(/9\.9\.9/)
    expect(fs.existsSync(path.join(h.dir, 'contributor-tmp')) ? fs.readdirSync(path.join(h.dir, 'contributor-tmp')) : []).toEqual([])
    expect(h.calls.some((c) => c.url.endsWith('/upload-file'))).toBe(false)
    expect(h.jobs().some((j) => j.message?.includes('zipping'))).toBe(false)
    const { lastRun } = await h.svc.contributor.view()
    expect(lastRun).toMatchObject({ published: [], stoppedEarly: true })
  })

  it('a run with no token stops with words, not with a request', async () => {
    const h = await signedIn({ route: cfUpload() })
    h.install(PLACES)
    h.store.saveConfig({ projects: { [PLACES]: '100' } })
    const end = await h.finished(await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge'))
    expect(end.phase).toBe('error')
    expect(end.message).toMatch(/token/)
    expect((await h.svc.contributor.view()).lastRun?.stoppedEarly).toBe(true)
  })

  it('a run with nothing to send asks CurseForge nothing and ends done', async () => {
    const h = await signedIn({ route: cfUpload() })
    h.store.setToken('curseforge', CF_TOKEN)
    h.store.saveConfig({ gameVersions: '9.9.9' })
    const end = await h.finished(await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge'))
    expect(end.phase).toBe('done')
    expect((await h.svc.contributor.view()).lastRun).toMatchObject({ published: [], failed: [], stoppedEarly: false })
  })

  it('only uploads that one folder even from awaiting or unchecked, and refuses linked, stale or not-installed', async () => {
    const h = await signedIn({
      route: (c) => {
        if (c.url.includes('cfwidget')) throw new Error('offline')
        return cfUpload()(c)
      }
    })
    h.install(PLACES)
    h.install(READABLES)
    h.install(BOSSES)
    configureCf(h, { [PLACES]: '100', [READABLES]: '200', [BOSSES]: '300' })
    h.store.recordUpload({ store: 'curseforge', folder: PLACES, version: '1.2.0', fileId: '1', at: 'now' })

    expect((await h.svc.contributor.rows(h.game.id, 'deDE', 'curseforge')).find((r) => r.folder === READABLES)?.state).toBe('unchecked')

    // Awaiting.
    expect((await h.finished(await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge', PLACES))).phase).toBe('done')
    expect((await h.svc.contributor.view()).lastRun!.published.map((p) => p.folder)).toEqual([PLACES])
    // Unchecked.
    expect((await h.finished(await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge', READABLES))).phase).toBe('done')
    const { lastRun } = await h.svc.contributor.view()
    expect(lastRun!.published.map((p) => p.folder)).toEqual([READABLES])
    expect(lastRun!.skipped).toEqual([])
    expect(h.store.uploads('curseforge').map((u) => u.folder)).toEqual([PLACES, PLACES, READABLES])

    // Not installed.
    await expect(h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge', 'SpokenQuestsAudioHorde_deDE')).rejects.toThrow(/not installed/)
    // Stale.
    h.svc.channel!.packs[BOSSES]!.rev = 'r9'
    await expect(h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge', BOSSES)).rejects.toThrow(/Update/)
    // Linked.
    const real = path.join(tmpDir(), READABLES)
    fs.renameSync(path.join(h.game.addOnsPath, READABLES), real)
    fs.symlinkSync(real, path.join(h.game.addOnsPath, READABLES))
    await expect(h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge', READABLES)).rejects.toThrow(/link/)
  })

  it('only refuses a folder outside the language, and a folder with no project', async () => {
    const h = await signedIn()
    h.install(PLACES)
    h.store.setToken('curseforge', CF_TOKEN)
    await expect(h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge', '../../evil')).rejects.toThrow(/not one of/)
    await expect(h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge', PLACES)).rejects.toThrow(/project id/)
  })

  it('publish refuses a language the account does not administer', async () => {
    const h = await signedIn()
    await expect(h.svc.contributor.publish(h.game.id, 'frFR', 'curseforge')).rejects.toThrow(/frFR/)
    expect(h.jobs()).toEqual([])
  })

  it('cancel aborts, leaves finished uploads recorded and removes the temp zip', async () => {
    let harness: Harness | null = null
    let jobId = ''
    let zipsDuringUpload = 0
    const h = await signedIn({
      route: cfUpload((project, call) => {
        if (project !== '200') return undefined
        const h = harness!
        zipsDuringUpload = fs.readdirSync(path.join(h.dir, 'contributor-tmp')).length
        return new Promise<Response>((_resolve, reject) => {
          call.init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          h.svc.cancel(jobId)
        })
      })
    })
    harness = h
    const quests = 'SpokenQuestsAudioGossip_deDE'
    h.install(PLACES)
    h.install(READABLES)
    h.install(BOSSES)
    h.install(quests)
    configureCf(h, { [quests]: '100', [PLACES]: '200', [READABLES]: '300', [BOSSES]: '400' })
    jobId = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    const end = await h.finished(jobId)
    expect(end.phase).toBe('cancelled')
    expect(zipsDuringUpload).toBe(1)
    expect(fs.readdirSync(path.join(h.dir, 'contributor-tmp'))).toEqual([])
    expect(h.store.uploads('curseforge').map((u) => u.folder)).toEqual([quests])
    const { lastRun } = await h.svc.contributor.view()
    expect(lastRun).toMatchObject({ stoppedEarly: true, failed: [] })
    expect(lastRun!.published.map((p) => p.folder)).toEqual([quests])
    expect(h.calls.filter((c) => c.url.endsWith('/upload-file'))).toHaveLength(2)
    expect(h.events.some((e) => e.channel === CHANNELS.contributorChanged)).toBe(true)
  })

  it('sends a GitHub run through the release steps and reports a pack already there as skipped', async () => {
    const uploaded: string[] = []
    const h = await signedIn({
      route: async (c) => {
        const tag = /\/releases\/tags\/(.+)$/.exec(c.url)
        if (tag) {
          const folder = decodeURIComponent(tag[1]!).split('/')[0]!
          if (c.url.includes('%2F')) return new Response('', { status: 404 }) // the row's look
          if (folder === BOSSES) return json({ id: 7, assets: [{ name: `${BOSSES}-1.2.0.zip` }] })
          return new Response('', { status: 404 })
        }
        if (c.url.endsWith('/repos/me/packs/releases')) return json({ id: 5, assets: [] }, 201)
        if (c.url.includes('uploads.github.com')) {
          await new Response(c.init.body as BodyInit).arrayBuffer()
          uploaded.push(new URL(c.url).searchParams.get('name')!)
          return json({}, 201)
        }
        return undefined
      }
    })
    h.install(PLACES)
    h.install(BOSSES)
    h.store.setToken('github', GH_TOKEN)
    h.store.saveConfig({ repo: 'me/packs' })
    const end = await h.finished(await h.svc.contributor.publish(h.game.id, 'deDE', 'github'))
    expect(end.phase).toBe('done')
    const { lastRun } = await h.svc.contributor.view()
    expect(uploaded).toEqual([`${PLACES}-1.2.0.zip`])
    expect(lastRun!.published).toEqual([{ folder: PLACES, version: '1.2.0', link: `https://github.com/me/packs/releases/tag/${PLACES}/v1.2.0` }])
    expect(lastRun!.skipped).toContain(BOSSES)
    // Only what was sent: the pack already there is not this Manager's upload.
    expect(h.store.uploads('github').map((u) => [u.folder, u.version, u.fileId])).toEqual([[PLACES, '1.2.0', null]])
  })

  it('one publish per store at a time: another language, another folder or another game is refused, not dropped', async () => {
    let release: (r: Response) => void = () => undefined
    let started: () => void = () => undefined
    const running = new Promise<void>((r) => (started = r))
    const h = await signedIn({
      adminLangs: ['deDE', 'frFR'],
      route: cfUpload((project) => {
        if (project !== '100') return undefined
        started()
        return new Promise<Response>((r) => (release = r))
      })
    })
    h.install(PLACES)
    configureCf(h, { [PLACES]: '100' })
    const other = await makeGame(tmpDir())
    h.svc.games = [h.game, other]

    const jobId = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    await running
    await expect(h.svc.contributor.publish(h.game.id, 'frFR', 'curseforge')).rejects.toThrow(/already running/)
    await expect(h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge', PLACES)).rejects.toThrow(/already running/)
    await expect(h.svc.contributor.publish(other.id, 'deDE', 'curseforge')).rejects.toThrow(/already running/)
    expect(new Set(h.jobs().map((j) => j.jobId))).toEqual(new Set([jobId]))

    release(json({ id: 1 }))
    expect((await h.finished(jobId)).phase).toBe('done')
    const again = await h.svc.contributor.publish(h.game.id, 'frFR', 'curseforge')
    expect(again).not.toBe(jobId)
    await h.finished(again)
  })

  it('two publish calls at the same moment give one run', async () => {
    const h = await signedIn({ route: cfUpload() })
    configureCf(h, {})
    const both = await Promise.allSettled([h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge'), h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')])
    expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const run = both.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<string>
    await h.finished(run.value)
  })

  it('a publish cancelled while queued frees its store', async () => {
    const h = await signedIn({ route: cfUpload() })
    h.store.setToken('curseforge', CF_TOKEN)
    let unblock: () => void = () => undefined
    const blocker = h.svc.jobs.enqueue({ gameId: h.game.id, productId: 'spoken', action: 'install', run: () => new Promise<void>((r) => (unblock = r)) })

    const queued = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    await expect(h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')).rejects.toThrow(/already running/)
    h.svc.cancel(queued)
    expect((await h.finished(queued)).phase).toBe('cancelled')
    const next = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    expect(next).not.toBe(queued)
    unblock()
    await h.finished(blocker)
    expect((await h.finished(next)).phase).toBe('done')
  })

  const cancelledRequest = (h: () => Harness, jobId: () => string, call: Call): Promise<Response> =>
    new Promise<Response>((_resolve, reject) => {
      call.init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      h().svc.cancel(jobId())
    })

  it('a cancel during the game version lookup ends the run as cancelled', async () => {
    let harness: Harness | null = null
    let jobId = ''
    const h = await signedIn({ route: (c) => (c.url.endsWith('/game/versions') ? cancelledRequest(() => harness!, () => jobId, c) : undefined) })
    harness = h
    h.install(PLACES)
    configureCf(h, { [PLACES]: '100' })
    jobId = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    expect((await h.finished(jobId)).phase).toBe('cancelled')
    expect(h.jobs().some((j) => j.message?.includes('zipping'))).toBe(false)
    expect((await h.svc.contributor.view()).lastRun).toMatchObject({ published: [], failed: [], stoppedEarly: true })
  })

  it('a cancel during the row check does not end as a run with nothing to send', async () => {
    let harness: Harness | null = null
    let jobId = ''
    const h = await signedIn({ route: (c) => (c.url.includes('cfwidget') ? cancelledRequest(() => harness!, () => jobId, c) : undefined) })
    harness = h
    h.install(PLACES)
    configureCf(h, { [PLACES]: '100' })
    jobId = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    expect((await h.finished(jobId)).phase).toBe('cancelled')
    expect(h.calls.some((c) => c.url.endsWith('/game/versions'))).toBe(false)
    expect((await h.svc.contributor.view()).lastRun?.stoppedEarly).toBe(true)
  })

  it('a failure read after a cancel is the cancel, not a failed pack', async () => {
    let harness: Harness | null = null
    let jobId = ''
    const h = await signedIn({
      route: cfUpload(() => {
        harness!.svc.cancel(jobId)
        return json({ error: 'cut short' }, 500)
      })
    })
    harness = h
    h.install(PLACES)
    configureCf(h, { [PLACES]: '100' })
    jobId = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    expect((await h.finished(jobId)).phase).toBe('cancelled')
    expect((await h.svc.contributor.view()).lastRun).toMatchObject({ failed: [], stoppedEarly: true })
  })

  it('a run keeps to the game it started on', async () => {
    const h = await signedIn({ route: cfUpload() })
    h.install(PLACES)
    configureCf(h, { [PLACES]: '100' })
    const jobId = await h.svc.contributor.publish(h.game.id, 'deDE', 'curseforge')
    h.svc.games = []
    expect((await h.finished(jobId)).phase).toBe('done')
    expect((await h.svc.contributor.view()).lastRun!.published).toHaveLength(1)
  })
})

describe('cleanup', () => {
  it('cleanup removes a leftover contributor-tmp folder', async () => {
    const dir = tmpDir()
    write(path.join(dir, 'contributor-tmp', 'abc.zip'), 'partial')
    await cleanContributorTmp(dir)
    expect(fs.existsSync(path.join(dir, 'contributor-tmp'))).toBe(false)
    await expect(cleanContributorTmp(dir)).resolves.toBeUndefined()
  })

  it('starting the service clears what a quit left behind', async () => {
    const h = await setup()
    write(path.join(h.dir, 'contributor-tmp', 'abc.zip'), 'partial')
    await h.svc.init()
    expect(fs.existsSync(path.join(h.dir, 'contributor-tmp'))).toBe(false)
  })
})

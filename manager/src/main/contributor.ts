// Passwords, tokens and cookies never enter a thrown error or a log line here, since ipc.ts logs what
// is thrown and the window shows it.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ContributorConfig, ContributorView, GameInstall, JobProgress, PublishResult, ReleaseRow, StoreId } from '../shared/types'
import { compareVersions } from '../shared/version'
import { languageFolders } from '../shared/products'
import { cfPublicVersions, deriveRow, ghHasAsset } from './contributor-status'
import { CONTRIBUTOR_TMP } from './cleanup'
import { ContributorStore, type SecretBox, type UploadRecord } from './contributor-store'
import { cfProjectLink, checkCfToken, checkGhRepo, resolveGameVersions, uploadCurseForge, uploadGitHub, zipFolder, type UploadProgress } from './contributor-upload'
import { CancelledError, isAbortError, plainMessage, PlainError, throwIfAborted, withTimeout } from './errors'
import { isLinked } from './guard'
import type { JobManager, JobSpec } from './jobs'
import type { ChannelIndex } from './packs-remote'
import { loadPackState } from './packs-state'
import { log } from './state'
import { parseTocVersion } from './status'

const SITE_URL = 'https://spoken.quest'
const SITE_TIMEOUT_MS = 15_000
const PROGRESS_INTERVAL_MS = 250
/** A stalled read would otherwise hold the store's run and the game's job queue until someone cancels. */
const CHANNEL_TIMEOUT_MS = 30_000
const STORE_NAMES: Record<StoreId, string> = { curseforge: 'CurseForge', github: 'GitHub' }
/** Long enough for one screen's stores and its refresh button to share a request. */
const ROWS_CHANNEL_MAX_AGE_MS = 60_000

type Account = NonNullable<ContributorView['account']>
type JobContext = Parameters<JobSpec['run']>[0]

export interface ContributorDeps {
  dataPath: string
  box: SecretBox
  fetchImpl: typeof fetch
  siteUrl?: string
  jobs: JobManager
  game: (gameId: string) => GameInstall
  channel: () => ChannelIndex | null
  /** Replaces what `channel` answers; rejects, leaving it as it was, when no verified index came back. `maxAgeMs` accepts one that recent. */
  refreshChannel: (options: { maxAgeMs?: number; signal?: AbortSignal }) => Promise<void>
  changed: (view: ContributorView) => void
}

export function withUserAgent(fetchImpl: typeof fetch, appVersion: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set('User-Agent', `SpokenManager/${appVersion}`)
    return fetchImpl(input, { ...init, headers })
  }
}

/** Refuses every secret: what a service built without the operating system's secret store has. */
export const NO_SECRET_BOX: SecretBox = {
  available: () => false,
  seal: () => {
    throw new Error('Nothing can be sealed without a secret store.')
  },
  open: () => ''
}

interface Pack {
  folder: string
  version?: string
  title?: string
  linked: boolean
  stale: boolean
}

function tocTitle(text: string): string | undefined {
  const m = /^[ \t]*##[ \t]*Title[ \t]*:[ \t]*(.*?)[ \t]*$/im.exec(text.replace(/^﻿/, ''))
  const title = m?.[1]?.replace(/\|c[0-9a-fA-F]{8}/g, '').replace(/\|r/g, '').trim()
  return title || undefined
}

/** The `name=value` of each cookie the site set, whatever it names them; an emptied cookie is a deletion. */
function cookiePairs(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';', 1)[0]!.trim())
    .filter((pair) => /^[^=]+=.+$/.test(pair))
    .join('; ')
}

function parseAccount(body: unknown): Account | null {
  const { email, adminLangs } = (body ?? {}) as { email?: unknown; adminLangs?: unknown }
  if (typeof email !== 'string' || !Array.isArray(adminLangs) || !adminLangs.every((l) => typeof l === 'string')) return null
  return { email, adminLangs: adminLangs as string[] }
}

export class ContributorService {
  private readonly store: ContributorStore
  private readonly site: string
  /** The account as last confirmed; a site that cannot be reached is no reason to forget it. */
  private known: Account | null = null
  /** A cookie is kept and the site gave no answer about it. */
  private unreachable = false
  /** The site ended a session the user had not asked to end. */
  private expired = false
  private readonly lastRuns: Partial<Record<StoreId, PublishResult>> = {}
  /**
   * One run per store across all games. JobManager would hand a second request the running job's id,
   * dropping it unseen, and runs on two games would go in parallel and could send a folder twice.
   */
  private readonly publishing = new Set<StoreId>()

  constructor(private readonly deps: ContributorDeps) {
    this.store = new ContributorStore(deps.dataPath, deps.box)
    this.site = new URL(deps.siteUrl ?? SITE_URL).origin
  }

  // ---------------------------------------------------------------- account

  /**
   * A redirect is an error because it would carry the password or the cookie to wherever it points.
   * The failure's own text is dropped, since a request's error can quote the request.
   */
  private async siteRequest(route: string, init: RequestInit): Promise<Response> {
    try {
      return await this.deps.fetchImpl(`${this.site}${route}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(SITE_TIMEOUT_MS) })
    } catch {
      throw new PlainError('Could not reach the site.')
    }
  }

  /** Tells the window too, since the call that found out may be about something else, such as the rows. */
  private clearSession(): void {
    this.store.setCookie(null)
    this.expired = this.known !== null
    this.known = null
    this.unreachable = false
    this.deps.changed(this.localView())
  }

  /** Only a 401 ends the session: an outage must not sign the admin out. */
  private async account(): Promise<Account | null> {
    const cookie = this.store.cookie()
    if (!cookie) {
      this.known = null
      this.unreachable = false
      return null
    }
    try {
      const res = await this.siteRequest('/api/manager/contributor', { headers: { Cookie: cookie } })
      const account = res.ok ? parseAccount(await res.json()) : null
      // A sign-out or a new sign-in came first, so this answer is about a session that is gone.
      if (this.store.cookie() !== cookie) return this.known
      if (res.status === 401) {
        this.clearSession()
        return null
      }
      if (account) this.known = account
      this.unreachable = !account
    } catch {
      // Keeps what is known; a cookie still stored tells requireAdmin the site was the problem.
      if (this.store.cookie() === cookie) this.unreachable = true
    }
    return this.known
  }

  private async requireAdmin(lang: string): Promise<void> {
    const account = await this.account()
    if (!account) {
      throw new PlainError(this.store.cookie() ? 'Could not reach the site to check your account. Try again.' : 'Sign in to the site first.')
    }
    if (!account.adminLangs.includes(lang)) throw new PlainError(`Your account does not administer ${lang}.`)
  }

  private localView(): ContributorView {
    return { account: this.known, config: this.store.config(), siteUnreachable: this.unreachable, sessionExpired: this.expired, lastRuns: { ...this.lastRuns } }
  }

  async view(): Promise<ContributorView> {
    await this.account()
    return this.localView()
  }

  async signIn(email: string, password: string): Promise<ContributorView> {
    // Checked first, so a password is not sent for a session that could not be kept.
    this.store.requireBox()
    const res = await this.siteRequest('/api/auth/sign-in/email', {
      method: 'POST',
      // The site refuses a sign-in with no Origin, and a main-process request has none of its own.
      headers: { 'Content-Type': 'application/json', Origin: this.site },
      body: JSON.stringify({ email: email.trim(), password })
    })
    if (res.status === 400 || res.status === 401) throw new PlainError('That email or password is not right.')
    if (res.status === 429) throw new PlainError('The site asked to wait. Try again in a while.')
    if (!res.ok) throw new PlainError(`The site answered HTTP ${res.status}.`)
    const cookie = cookiePairs(res)
    if (!cookie) throw new PlainError('The site did not keep you signed in.')
    this.store.setCookie(cookie)
    // An earlier account must not pass for this session if the site cannot be asked.
    this.known = null
    if (!(await this.account())) {
      this.clearSession()
      throw new PlainError('The site did not confirm the sign-in. Try again.')
    }
    this.expired = false
    return this.localView()
  }

  async signOut(): Promise<ContributorView> {
    const cookie = this.store.cookie()
    this.store.setCookie(null)
    this.known = null
    this.unreachable = false
    this.expired = false
    if (cookie) {
      // Ends the session on the site as well, when it can be reached; the Manager has forgotten it either way.
      await this.siteRequest('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: this.site, Cookie: cookie },
        body: '{}'
      }).catch(() => undefined)
    }
    return this.localView()
  }

  // ---------------------------------------------------------------- stores

  /** Every check runs before the first write, so a refused save changes nothing. */
  async saveStore(input: { store: StoreId; token?: string; projects?: Record<string, string>; repo?: string; gameVersions?: string }): Promise<ContributorView> {
    const token = input.token?.trim()
    if (token) this.store.requireBox()
    if (input.store === 'curseforge' && token) await checkCfToken(token, this.deps.fetchImpl)
    if (input.store === 'github') {
      const saved = this.store.config().repo
      const repo = input.repo?.trim() ?? saved
      const newRepo = repo !== '' && repo !== saved
      // A token being removed may be the revoked one, so it checks nothing.
      const checkWith = token || (newRepo && input.token === undefined ? this.store.token('github') : null)
      if (checkWith) await checkGhRepo(checkWith, repo, this.deps.fetchImpl)
    }
    this.store.saveConfig({
      ...(input.projects ? { projects: input.projects } : {}),
      ...(input.repo !== undefined ? { repo: input.repo } : {}),
      ...(input.gameVersions !== undefined ? { gameVersions: input.gameVersions } : {})
    })
    if (token !== undefined) this.store.setToken(input.store, token)
    return this.view()
  }

  // ---------------------------------------------------------------- rows

  /**
   * Stale also covers a channel that is not loaded or does not carry the folder: a release must not
   * publish what cannot be confirmed current.
   */
  private isStale(game: GameInstall, folder: string): boolean {
    const wanted = this.deps.channel()?.packs[folder]?.rev
    return !wanted || loadPackState(game, folder)?.rev !== wanted
  }

  private async inspect(game: GameInstall, folders: string[]): Promise<Pack[]> {
    // An AddOns (or Interface) folder that is itself a link counts for every pack in it.
    const addOnsLinked = (await isLinked(game.addOnsPath)) || (await isLinked(path.dirname(game.addOnsPath)))
    return Promise.all(
      folders.map(async (folder) => {
        let text = ''
        try {
          text = await fs.promises.readFile(path.join(game.addOnsPath, folder, `${folder}.toc`), 'utf8')
        } catch {
          // Not installed: no version, so its row says so.
        }
        const version = parseTocVersion(text)
        const title = tocTitle(text)
        return {
          folder,
          ...(version && compareVersions(version, version) !== null ? { version } : {}),
          ...(title ? { title } : {}),
          linked: addOnsLinked || (await isLinked(path.join(game.addOnsPath, folder))),
          stale: this.isStale(game, folder)
        }
      })
    )
  }

  /** Why a folder must not be sent by itself, as words for the window. */
  private refusal(pack: Pack, store: StoreId, config: ContributorConfig): string | null {
    if (!pack.version) return `${pack.folder} is not installed.`
    if (pack.linked) return `${pack.folder} is a link to a checkout, so it cannot be published.`
    if (pack.stale) return `Update ${pack.folder} in the Manager first.`
    if (store === 'curseforge' && !config.projects[pack.folder]) return `${pack.folder} has no CurseForge project id.`
    return null
  }

  private async rowOf(pack: Pack, on: { store: StoreId; config: ContributorConfig; token: string | null; uploads: UploadRecord[]; signal: AbortSignal | undefined }): Promise<ReleaseRow> {
    const { folder, version } = pack
    const { store, config, token, uploads, signal } = on
    const project = store === 'curseforge' ? config.projects[folder] : undefined
    let publicVersions: string[] | null = null
    let link = project ? cfProjectLink(project) : undefined
    // A folder that could not be sent anyway is not worth a request.
    if (version && !pack.linked && !pack.stale) {
      if (project) publicVersions = await cfPublicVersions(project, this.deps.fetchImpl, signal)
      if (store === 'github' && token && config.repo) {
        const found = await ghHasAsset(config.repo, token, folder, version, this.deps.fetchImpl, signal)
        if (found) publicVersions = found.live ? [version] : []
        if (found?.live) link = found.link
      }
    }
    const state = deriveRow({
      store,
      folder,
      ...(version ? { installedVersion: version } : {}),
      linked: pack.linked,
      stale: pack.stale,
      ...(project ? { project } : {}),
      publicVersions,
      uploads
    })
    return { folder, ...(version ? { version } : {}), state, ...(link ? { link } : {}) }
  }

  private rowsOf(packs: Pack[], store: StoreId, signal?: AbortSignal): Promise<ReleaseRow[]> {
    const on = {
      store,
      config: this.store.config(),
      token: store === 'github' ? this.store.token(store) : null,
      // GitHub shows a release at once, so only CurseForge's review leaves anything awaiting.
      uploads: store === 'curseforge' ? this.store.uploads(store) : [],
      signal
    }
    return Promise.all(packs.map((p) => this.rowOf(p, on)))
  }

  async rows(gameId: string, lang: string, store: StoreId): Promise<ReleaseRow[]> {
    await this.requireAdmin(lang)
    // The Manager may have stayed open across a site release, and an old index reads an older folder as current.
    // Rows can still be drawn from the last verified index, because a run fetches its own before it sends anything.
    await this.deps.refreshChannel({ maxAgeMs: ROWS_CHANNEL_MAX_AGE_MS }).catch(() => undefined)
    return this.rowsOf(await this.inspect(this.deps.game(gameId), languageFolders(lang)), store)
  }

  // ---------------------------------------------------------------- publish

  /** `only` sends one folder whatever its row says about the store, but not one that is unsafe to send. */
  async publish(gameId: string, lang: string, store: StoreId, only?: string): Promise<string> {
    await this.requireAdmin(lang)
    const game = this.deps.game(gameId)
    const folders = languageFolders(lang)
    if (only !== undefined) {
      if (!folders.includes(only)) throw new PlainError(`${only} is not one of the ${lang} packs.`)
      const refused = this.refusal((await this.inspect(game, [only]))[0]!, store, this.store.config())
      if (refused) throw new PlainError(refused)
    }
    // After the awaits above, with none before enqueue, so two calls at once cannot both pass.
    if (this.publishing.has(store)) {
      throw new PlainError(`A release to ${STORE_NAMES[store]} is already running. Wait for it to end or cancel it.`)
    }
    this.publishing.add(store)
    return this.deps.jobs.enqueue({
      gameId,
      productId: `publish/${store}`,
      action: 'publish',
      onDropped: () => this.publishing.delete(store),
      run: (ctx) => this.runJob(game, lang, only ? [only] : folders, store, only !== undefined, ctx)
    })
  }

  private async runJob(game: GameInstall, lang: string, folders: string[], store: StoreId, again: boolean, ctx: JobContext): Promise<void> {
    const result: PublishResult = { store, lang, published: [], skipped: [], failed: [], stoppedEarly: false }
    try {
      await this.sendPacks(game, folders, store, again, result, ctx)
    } catch (err) {
      result.stoppedEarly = true
      throw err
    } finally {
      this.publishing.delete(store)
      this.lastRuns[store] = { ...result, finishedAt: new Date().toISOString() }
      log(`Publish to ${store}: ${result.published.length} sent, ${result.skipped.length} skipped, ${result.failed.length} failed${result.stoppedEarly ? ', stopped early' : ''}.`)
      this.deps.changed(this.localView())
    }
  }

  private async sendPacks(game: GameInstall, folders: string[], store: StoreId, again: boolean, result: PublishResult, ctx: JobContext): Promise<void> {
    const name = STORE_NAMES[store]
    const token = this.store.token(store)
    if (!token) throw new PlainError(`Save your ${name} token under Stores first.`)
    const config = this.store.config()
    if (store === 'github' && !config.repo) throw new PlainError('Save your GitHub repository under Stores first.')

    // Publishing on an old index would send an older folder to the store as the current release.
    try {
      await this.deps.refreshChannel({ signal: withTimeout(CHANNEL_TIMEOUT_MS, ctx.signal) })
    } catch {
      if (ctx.signal.aborted) throw new CancelledError()
      throw new PlainError('Could not check the voice pack channel, so nothing was published. Try again.')
    }

    // Read here and not when the job was asked for: it may have waited for an install on this game.
    const packs = await this.inspect(game, folders)
    let targets = packs
    if (again) {
      const refused = this.refusal(packs[0]!, store, config)
      if (refused) throw new PlainError(refused)
    } else {
      const rows = await this.rowsOf(packs, store, ctx.signal)
      // A cancelled look answers like an outage, so without this the run would seem to have had nothing to send.
      throwIfAborted(ctx.signal)
      targets = packs.filter((_, i) => rows[i]!.state === 'unreleased')
      for (const row of rows) {
        if (row.state !== 'unreleased') result.skipped.push({ folder: row.folder, reason: row.state })
      }
    }
    if (targets.length === 0) return

    const gameVersionIds = store === 'curseforge' ? await resolveGameVersions(token, config.gameVersions, this.deps.fetchImpl, ctx.signal) : []
    const tmp = path.join(this.deps.dataPath, CONTRIBUTOR_TMP)
    await fs.promises.mkdir(tmp, { recursive: true })

    for (const [i, pack] of targets.entries()) {
      throwIfAborted(ctx.signal)
      const n = i + 1
      const say = (step: string, bytes?: { received: number; total: number; bytesPerSecond: number }): void =>
        this.progress(ctx, game, store, `${n}/${targets.length} ${pack.folder}: ${step}`, bytes)
      // Unique per pack: runs on two games can be going at once.
      const zip = path.join(tmp, `${randomUUID()}.zip`)
      try {
        say('zipping')
        await zipFolder(game.addOnsPath, pack.folder, zip, ctx.signal)
        say('uploading')
        const started = Date.now()
        let lastSaid = 0
        const onProgress = (sent: number, total: number): void => {
          const now = Date.now()
          if (sent >= total) return say(`waiting for ${name}`)
          if (now - lastSaid < PROGRESS_INTERVAL_MS) return
          lastSaid = now
          say('uploading', { received: sent, total, bytesPerSecond: now > started ? (sent * 1000) / (now - started) : 0 })
        }
        await this.sendOne(pack, store, token, config, zip, gameVersionIds, result, ctx, onProgress)
      } catch (err) {
        // Aborted as well: reading a response the cancel cut short fails with words, not with an abort.
        if (isAbortError(err) || ctx.signal.aborted) throw new CancelledError()
        result.failed.push({ folder: pack.folder, reason: plainMessage(err) })
      } finally {
        await fs.promises.rm(zip, { force: true }).catch(() => undefined)
      }
    }
  }

  private async sendOne(pack: Pack, store: StoreId, token: string, config: ContributorConfig, zip: string, gameVersionIds: number[], result: PublishResult, ctx: JobContext, onProgress: UploadProgress): Promise<void> {
    const { folder } = pack
    const version = pack.version!
    const notes = `${pack.title ?? folder} ${version}`
    const common = { token, folder, version, zip, notes, signal: ctx.signal, fetchImpl: this.deps.fetchImpl, onProgress }
    let fileId: string | null = null
    let link: string
    if (store === 'github') {
      const sent = await uploadGitHub({ ...common, repo: config.repo })
      if (sent.alreadyThere) {
        result.skipped.push({ folder, reason: 'already-there' })
        return
      }
      link = sent.link
    } else {
      const sent = await uploadCurseForge({ ...common, project: config.projects[folder]!, gameVersionIds })
      fileId = sent.fileId
      link = sent.link
    }
    result.published.push({ folder, version, link })
    try {
      // Written now and not at the end of the run, so a quit or a cancel cannot forget what the store received.
      this.store.recordUpload({ store, folder, version, fileId, at: new Date().toISOString() })
    } catch (err) {
      // The file is up, so this is not a failed pack, which would invite sending it twice.
      log(`Could not record the upload of ${folder}:`, err)
    }
  }

  /** `received` and `total` are the bytes of the pack being sent; without them the window draws a moving bar. */
  private progress(ctx: JobContext, game: GameInstall, store: StoreId, message: string, bytes = { received: 0, total: 0, bytesPerSecond: 0 }): void {
    const progress: JobProgress = {
      jobId: ctx.jobId,
      gameId: game.id,
      productId: `publish/${store}`,
      action: 'publish',
      phase: 'installing',
      ...bytes,
      message
    }
    ctx.emit(progress)
  }
}

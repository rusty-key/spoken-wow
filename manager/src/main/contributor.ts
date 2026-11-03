// What a language admin does from the Manager: signs in to the site, keeps store settings, sees where
// each pack of a language stands and publishes it. Passwords, tokens and cookies never enter a thrown
// error or a log line here, since ipc.ts logs what is thrown and the window shows it.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ContributorConfig, ContributorView, GameInstall, JobProgress, PublishResult, ReleaseRow, StoreId } from '../shared/types'
import { compareVersions } from '../shared/version'
import { cfPublicVersions, deriveRow, ghHasAsset, languageFolders } from './contributor-status'
import { CONTRIBUTOR_TMP } from './cleanup'
import { ContributorStore, type SecretBox } from './contributor-store'
import { cfProjectLink, checkCfToken, checkGhRepo, resolveGameVersions, uploadCurseForge, uploadGitHub, zipFolder } from './contributor-upload'
import { CancelledError, isAbortError, plainMessage, PlainError, throwIfAborted } from './errors'
import { isLinked } from './guard'
import type { JobManager, JobSpec } from './jobs'
import type { ChannelIndex } from './packs-remote'
import { loadPackState } from './packs-state'
import { log } from './state'
import { parseTocVersion } from './status'

const SITE_URL = 'https://spoken.rusty.one'
const SITE_TIMEOUT_MS = 15_000
const STORE_NAMES: Record<StoreId, string> = { curseforge: 'CurseForge', github: 'GitHub' }

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
  changed: (view: ContributorView) => void
}

/** Refuses every secret: what a service built without the operating system's secret store has. */
export const NO_SECRET_BOX: SecretBox = {
  available: () => false,
  seal: () => {
    throw new Error('Nothing can be sealed without a secret store.')
  },
  open: () => ''
}

/** A pack folder as it stands on disk. */
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
  private lastRun: PublishResult | null = null

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

  /** Only a 401 ends the session: an outage must not sign the admin out. */
  private async account(): Promise<Account | null> {
    const cookie = this.store.cookie()
    if (!cookie) {
      this.known = null
      return null
    }
    try {
      const res = await this.siteRequest('/api/manager/contributor', { headers: { Cookie: cookie } })
      if (res.status === 401) {
        this.store.setCookie(null)
        this.known = null
        return null
      }
      if (res.ok) this.known = parseAccount(await res.json()) ?? this.known
    } catch {
      // Keeps what is known; a cookie still stored tells requireAdmin the site was the problem.
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
    return { account: this.known, config: this.store.config(), canStoreSecrets: this.deps.box.available(), lastRun: this.lastRun }
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
    if (!(await this.account())) throw new PlainError('The site did not confirm the sign-in. Try again.')
    return this.localView()
  }

  async signOut(): Promise<ContributorView> {
    const cookie = this.store.cookie()
    this.store.setCookie(null)
    this.known = null
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
      const checkWith = token || (newRepo ? this.store.token('github') : null)
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

  /** A folder that "upload again" must not send, as words for the window. */
  private refusal(pack: Pack, store: StoreId, config: ContributorConfig): string | null {
    if (!pack.version) return `${pack.folder} is not installed.`
    if (pack.linked) return `${pack.folder} is a link to a checkout, so it cannot be published.`
    if (pack.stale) return `Update ${pack.folder} in the Manager first.`
    if (store === 'curseforge' && !config.projects[pack.folder]) return `${pack.folder} has no CurseForge project id.`
    return null
  }

  private async rowOf(pack: Pack, store: StoreId, config: ContributorConfig): Promise<ReleaseRow> {
    const { folder, version } = pack
    const project = store === 'curseforge' ? config.projects[folder] : undefined
    const token = this.store.token(store)
    let publicVersions: string[] | null = null
    let link = project ? cfProjectLink(project) : undefined
    // A folder that could not be sent anyway is not worth a request.
    if (version && !pack.linked && !pack.stale) {
      if (project) publicVersions = await cfPublicVersions(project, this.deps.fetchImpl)
      if (store === 'github' && token && config.repo) {
        const found = await ghHasAsset(config.repo, token, folder, version, this.deps.fetchImpl)
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
      // GitHub shows a release at once, so only CurseForge's review leaves anything awaiting.
      uploads: store === 'curseforge' ? this.store.uploads(store) : []
    })
    return { folder, ...(version ? { version } : {}), state, ...(link ? { link } : {}), ...(project ? { project } : {}) }
  }

  private rowsOf(packs: Pack[], store: StoreId): Promise<ReleaseRow[]> {
    const config = this.store.config()
    return Promise.all(packs.map((p) => this.rowOf(p, store, config)))
  }

  async rows(gameId: string, lang: string, store: StoreId): Promise<ReleaseRow[]> {
    await this.requireAdmin(lang)
    return this.rowsOf(await this.inspect(this.deps.game(gameId), languageFolders(lang)), store)
  }

  // ---------------------------------------------------------------- publish

  /** `only` is "upload again": it skips the row's store state but not what makes a folder unsafe to send. */
  async publish(gameId: string, lang: string, store: StoreId, only?: string): Promise<string> {
    await this.requireAdmin(lang)
    const game = this.deps.game(gameId)
    const folders = languageFolders(lang)
    if (only !== undefined) {
      if (!folders.includes(only)) throw new PlainError(`${only} is not one of the ${lang} packs.`)
      const refused = this.refusal((await this.inspect(game, [only]))[0]!, store, this.store.config())
      if (refused) throw new PlainError(refused)
    }
    return this.deps.jobs.enqueue({
      gameId,
      productId: `publish/${store}`,
      action: 'publish',
      run: (ctx) => this.runJob(game, only ? [only] : folders, store, only !== undefined, ctx)
    })
  }

  private async runJob(game: GameInstall, folders: string[], store: StoreId, again: boolean, ctx: JobContext): Promise<void> {
    const result: PublishResult = { store, published: [], skipped: [], failed: [], stoppedEarly: false }
    try {
      await this.sendPacks(game, folders, store, again, result, ctx)
    } catch (err) {
      result.stoppedEarly = true
      throw err
    } finally {
      this.lastRun = result
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

    // Read here and not when the job was asked for: it may have waited for an install on this game.
    const packs = await this.inspect(game, folders)
    let targets = packs
    if (again) {
      const refused = this.refusal(packs[0]!, store, config)
      if (refused) throw new PlainError(refused)
    } else {
      const rows = await this.rowsOf(packs, store)
      targets = packs.filter((_, i) => rows[i]!.state === 'unreleased')
      result.skipped.push(...packs.filter((p) => !targets.includes(p)).map((p) => p.folder))
    }
    if (targets.length === 0) return

    const gameVersionIds = store === 'curseforge' ? await resolveGameVersions(token, config.gameVersions, this.deps.fetchImpl) : []
    const tmp = path.join(this.deps.dataPath, CONTRIBUTOR_TMP)
    await fs.promises.mkdir(tmp, { recursive: true })

    for (const [i, pack] of targets.entries()) {
      throwIfAborted(ctx.signal)
      const n = i + 1
      const say = (step: string): void => this.progress(ctx, game, store, n, targets.length, `${n}/${targets.length} ${pack.folder}: ${step}`)
      // Unique per pack: runs on two games can be going at once.
      const zip = path.join(tmp, `${randomUUID()}.zip`)
      try {
        say('zipping')
        await zipFolder(game.addOnsPath, pack.folder, zip, ctx.signal)
        say('uploading')
        await this.sendOne(pack, store, token, config, zip, gameVersionIds, result, ctx)
      } catch (err) {
        if (isAbortError(err)) throw new CancelledError()
        result.failed.push({ folder: pack.folder, reason: plainMessage(err) })
      } finally {
        await fs.promises.rm(zip, { force: true }).catch(() => undefined)
      }
    }
  }

  private async sendOne(pack: Pack, store: StoreId, token: string, config: ContributorConfig, zip: string, gameVersionIds: number[], result: PublishResult, ctx: JobContext): Promise<void> {
    const { folder } = pack
    const version = pack.version!
    const notes = `${pack.title ?? folder} ${version}`
    const common = { token, folder, version, zip, notes, signal: ctx.signal, fetchImpl: this.deps.fetchImpl }
    if (store === 'github') {
      const { link, alreadyThere } = await uploadGitHub({ ...common, repo: config.repo })
      if (alreadyThere) result.skipped.push(folder)
      else result.published.push({ folder, version, link })
      return
    }
    const { fileId, link } = await uploadCurseForge({ ...common, project: config.projects[folder]!, gameVersionIds })
    result.published.push({ folder, version, link })
    try {
      // Written now and not at the end of the run, so a quit or a cancel cannot forget what the store received.
      this.store.recordUpload({ store, folder, version, fileId, at: new Date().toISOString() })
    } catch (err) {
      // The file is up, so this is not a failed pack, which would invite sending it twice.
      log(`Could not record the upload of ${folder}:`, err)
    }
  }

  private progress(ctx: JobContext, game: GameInstall, store: StoreId, n: number, total: number, message: string): void {
    const progress: JobProgress = {
      jobId: ctx.jobId,
      gameId: game.id,
      productId: `publish/${store}`,
      action: 'publish',
      phase: 'installing',
      received: n,
      total,
      bytesPerSecond: 0,
      message
    }
    ctx.emit(progress)
  }
}

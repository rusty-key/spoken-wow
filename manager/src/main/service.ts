// The manager's logic without electron: what ipc.ts exposes to the window. Holds the game list,
// the settings and the catalog, and runs jobs.
import path from 'node:path'
import { CHANNELS, type AddGameResult, type ClearDownloadsResult, type InstallOptions } from '../shared/api'
import { isSupportedFlavor, type Catalog, type CommunityCatalog, type GameInstall, type JobProgress, type Product, type ProductStatus, type ReleaseInfo, type Settings, type SharingChoice, type SharingStatus, type Snapshot } from '../shared/types'
import { PRODUCTS, productById } from '../shared/products'
import { compareVersions } from '../shared/version'
import { buildCatalog, latestFor, loadCatalog, saveCatalog } from './catalog'
import { COMMUNITY_PREFIX, communityProduct, communityRelease, fetchCommunity, isCommunityProductId, loadCommunity, saveCommunity } from './community'
import { PlainError } from './errors'
import { checkDownloadsPath } from './guard'
import { cleanLeftovers, clearDownloads } from './cleanup'
import { addGame, notSupportedMessage, removeGame, scanGames } from './games'
import { fetchReleases } from './github'
import { installProduct, recoverInterrupted, uninstallProduct, type FsOps, type JobContext } from './install'
import { JobManager } from './jobs'
import { isChannelRelease } from '../shared/channel'
import { channelRelease, withChannel } from './packs-catalog'
import { PACKS_BASE_URL } from './packs-key'
import { estimatePack } from './packs-plan'
import { fetchIndex, fetchManifest, loadCachedIndex, loadCachedManifest, type ChannelIndex, type ChannelOptions, type ChannelPack } from './packs-remote'
import { dropPackState, loadPackState } from './packs-state'
import { syncPacks } from './packs-sync'
import { Generating, type Cipher } from './generating'
import { loadLedger, resetInstallId, sendPending, type SendResult, type ShareLedger } from './share'
import { loadSettings, loadState, log, sanitizeSettings, saveSettings } from './state'
import { computeStatuses } from './status'

export interface ServiceOptions {
  dataPath: string
  appVersion: string
  /** Sends an event to every window. */
  send: (channel: string, payload: unknown) => void
  fetchImpl?: typeof fetch
  /** Replaces the registry and default-folder search (tests). */
  autoPaths?: string[]
  isRunning?: () => Promise<boolean>
  ops?: Partial<FsOps>
  backoffMs?: number
  apiBase?: string
  /** Replaces the community registry url (tests). */
  communityUrl?: string
  /** Replaces the voice pack channel's address (tests). */
  packsBaseUrl?: string
  /** Replaces the channel's public key (tests). */
  packsPublicKey?: string
  /** How long a channel request may take before it is given up (default 30 s; tests). */
  packsTimeoutMs?: number
  /** Replaces the site's contributions address (tests, and SPOKEN_SHARE_URL in a dev build). */
  shareUrl?: string
  /** The system keychain the generating secrets are encrypted with; without one none are kept. */
  cipher?: Cipher
  /** Replaces the site's address for generating (tests, and SPOKEN_SITE_URL in a dev build). */
  siteUrl?: string
  /** Opens a link in the browser: where the author approves a pairing. */
  openExternal?: (url: string) => void
}

/** A catalog fetched less than this long ago is not fetched again unless forced. */
const FRESH_MS = 5 * 60 * 1000

/** How often the collected-lines files are looked at while sharing is on. */
export const SHARE_POLL_MS = 5 * 60 * 1000
/** The waits after the 1st, 2nd, 3rd and later failed sends in a row. */
export const SHARE_BACKOFF_MS = [1, 5, 15, 60].map((m) => m * 60 * 1000)

export class ManagerService {
  games: GameInstall[] = []
  settings: Settings
  catalog: Catalog
  readonly jobs: JobManager
  private refreshing: Promise<Catalog> | null = null
  private refreshingCommunity: Promise<CommunityCatalog> | null = null
  community: CommunityCatalog
  /** The channel's index: the last verified one, until a refresh brings a newer one. */
  channel: ChannelIndex | null = null
  /** Settles when the first scan is done; handlers wait for it. Never rejects. */
  ready: Promise<void> = Promise.resolve()
  sharingStatus: SharingStatus
  private sharing: { abort: AbortController; done: Promise<SendResult | null> } | null = null
  private shareFailures = 0
  private shareRetryAt = 0
  private shareTimer: ReturnType<typeof setInterval> | null = null
  /** share.json, read once and kept: every poll would otherwise parse up to LEDGER_CAP hashes. */
  private ledger: ShareLedger
  /** Null on a system with no keychain, where no key could be kept safely. */
  readonly generating: Generating | null

  constructor(private opts: ServiceOptions) {
    this.settings = loadSettings(opts.dataPath)
    this.catalog = loadCatalog(opts.dataPath)
    this.community = loadCommunity(opts.dataPath)
    this.channel = loadCachedIndex(opts.dataPath, opts.packsPublicKey)
    this.jobs = new JobManager((p: JobProgress) => opts.send(CHANNELS.jobProgress, p))
    this.ledger = loadLedger(opts.dataPath)
    this.sharingStatus = { sending: false, ...(this.ledger.lastSent ? { lastSent: this.ledger.lastSent } : {}) }
    this.generating = opts.cipher
      ? new Generating({
          dataPath: opts.dataPath,
          appVersion: opts.appVersion,
          cipher: opts.cipher,
          send: (status) => opts.send(CHANNELS.generateChanged, status),
          openExternal: opts.openExternal ?? (() => undefined),
          ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
          ...(opts.siteUrl ? { siteUrl: opts.siteUrl } : {})
        })
      : null
  }

  get dataPath(): string {
    return this.opts.dataPath
  }

  downloadsPath(): string {
    return this.settings.downloadsPath || path.join(this.opts.dataPath, 'downloads')
  }

  /** Starts the first scan; `ready` settles when it ends. */
  init(): Promise<void> {
    this.ready = this.scan()
      .then(async () => {
        // A swap cut short by a crash is undone first, then every leftover is cleared.
        for (const game of this.games) {
          const failed = await recoverInterrupted(game)
          if (failed.length > 0) log(`Could not restore ${failed.join(', ')} on ${game.label}; the backup is kept.`)
        }
        await cleanLeftovers(this.games, this.downloadsPath())
      })
      .then(
        () => undefined,
        (err) => log('First scan failed:', err)
      )
    return this.ready
  }

  snapshot(): Snapshot {
    return {
      games: this.games,
      settings: this.settings,
      catalog: this.catalog,
      community: this.community,
      products: PRODUCTS,
      appVersion: this.opts.appVersion,
      dataPath: this.opts.dataPath,
      platform: process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
      sharingStatus: this.sharingStatus,
      ...(this.generating ? { generateStatus: this.generating.status } : {})
    }
  }

  // ---------------------------------------------------------------- games

  async scan(): Promise<GameInstall[]> {
    this.games = await scanGames(this.opts.dataPath, this.opts.autoPaths ? { autoPaths: this.opts.autoPaths } : {})
    // The game last looked at may be gone, or may be one an earlier run listed that no longer is.
    if (this.settings.lastGameId && !this.games.some((g) => g.id === this.settings.lastGameId)) this.setSettings({ lastGameId: '' })
    this.opts.send(CHANNELS.gamesChanged, this.games)
    return this.games
  }

  requireGame(gameId: string): GameInstall {
    const g = this.games.find((x) => x.id === gameId)
    if (!g) throw new Error('Unknown game')
    return g
  }

  async addGame(input: string): Promise<AddGameResult> {
    const res = await addGame(this.opts.dataPath, input)
    if (res.error || res.games.length === 0) return { error: res.error ?? 'That folder could not be added.' }
    await this.scan()
    const first = res.games[0]!
    return { game: this.games.find((g) => g.id === first.id) ?? first }
  }

  removeGame(gameId: string): GameInstall[] {
    const g = this.requireGame(gameId)
    removeGame(this.opts.dataPath, g)
    this.games = this.games.filter((x) => x.id !== gameId)
    if (this.settings.lastGameId === gameId) this.setSettings({ lastGameId: '' })
    this.opts.send(CHANNELS.gamesChanged, this.games)
    return this.games
  }

  // ---------------------------------------------------------------- catalog

  refreshCatalog(force = false): Promise<Catalog> {
    if (this.refreshing) return this.refreshing
    if (!force && this.catalog.fetchedAt && !this.catalog.offline) {
      const age = Date.now() - Date.parse(this.catalog.fetchedAt)
      if (age >= 0 && age < FRESH_MS) return Promise.resolve(this.catalog)
    }
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<Catalog> {
    const [res, ch] = await Promise.all([
      fetchReleases({
        dataPath: this.opts.dataPath,
        appVersion: this.opts.appVersion,
        ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
        ...(this.opts.apiBase ? { apiBase: this.opts.apiBase } : {})
      }),
      fetchIndex(this.opts.dataPath, this.channelOptions())
    ])
    if (ch.index) this.channel = ch.index
    // When the request failed and nothing was cached, keep what the catalog already held.
    const keepOld = res.offline && res.releases.length === 0
    const next = keepOld
      ? { ...this.catalog, offline: true, ...(res.error ? { error: res.error } : {}) }
      : buildCatalog(res.releases, {
          fetchedAt: res.fetchedAt,
          offline: res.offline,
          ...(res.error ? { error: res.error } : {})
        })
    this.catalog = next
    try {
      saveCatalog(this.opts.dataPath, next)
    } catch (err) {
      log('Could not save the catalog:', err)
    }
    this.opts.send(CHANNELS.catalogChanged, next)
    // Warm the manifest cache of installed channel packs so the Update label can be computed offline. The window has
    // the catalog already; it is told again once a manifest it lacked has arrived, so the label's size can show.
    const wanted = new Map<string, ChannelPack>()
    for (const game of this.games) {
      for (const p of PRODUCTS) {
        const packs = this.channelPacks(p)
        if (!packs || !p.folders!.some((f) => loadPackState(game, f))) continue
        p.folders!.forEach((f, i) => {
          if (!loadCachedManifest(this.opts.dataPath, f, packs[i]!, this.opts.packsPublicKey)) wanted.set(f, packs[i]!)
        })
      }
    }
    if (wanted.size > 0) {
      const opts = this.channelOptions()
      const got = await Promise.all(
        [...wanted].map(([f, pack]) =>
          fetchManifest(this.opts.dataPath, f, pack, opts).then(
            () => true,
            (err: unknown) => {
              log(`Manifest of ${f}:`, err)
              return false
            }
          )
        )
      )
      if (got.some(Boolean)) this.opts.send(CHANNELS.catalogChanged, next)
    }
    return next
  }

  // ---------------------------------------------------------------- community

  refreshCommunity(force = false): Promise<CommunityCatalog> {
    if (this.refreshingCommunity) return this.refreshingCommunity
    if (!force && this.community.fetchedAt && !this.community.offline) {
      const age = Date.now() - Date.parse(this.community.fetchedAt)
      if (age >= 0 && age < FRESH_MS) return Promise.resolve(this.community)
    }
    this.refreshingCommunity = this.doRefreshCommunity().finally(() => {
      this.refreshingCommunity = null
    })
    return this.refreshingCommunity
  }

  private async doRefreshCommunity(): Promise<CommunityCatalog> {
    const next = await fetchCommunity({
      dataPath: this.opts.dataPath,
      appVersion: this.opts.appVersion,
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(this.opts.communityUrl ? { url: this.opts.communityUrl } : {})
    })
    this.community = next
    try {
      saveCommunity(this.opts.dataPath, next)
    } catch (err) {
      log('Could not save the community list:', err)
    }
    this.opts.send(CHANNELS.communityChanged, next)
    return next
  }

  /** The official table plus the registry's packs. */
  private allProducts(): Product[] {
    return [...PRODUCTS, ...this.community.packs.map((p) => communityProduct(p))]
  }

  /** The catalog with the registry's packs as one release each. */
  private effectiveCatalog(): Catalog {
    const releases = { ...this.catalog.releases }
    for (const p of this.community.packs) releases[COMMUNITY_PREFIX + p.id] = [communityRelease(p)]
    return withChannel({ ...this.catalog, releases }, PRODUCTS, this.channel, this.packsBase())
  }

  private packsBase(): string {
    return this.opts.packsBaseUrl ?? PACKS_BASE_URL
  }

  private channelOptions(signal?: AbortSignal): ChannelOptions {
    return {
      baseUrl: this.packsBase(),
      userAgent: `SpokenManager/${this.opts.appVersion}`,
      ...(this.opts.packsPublicKey ? { publicKey: this.opts.packsPublicKey } : {}),
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      signal: signal ?? AbortSignal.timeout(this.opts.packsTimeoutMs ?? 30000)
    }
  }

  /** The channel's pack for each folder of a voice product, in folder order; null unless the channel carries every one. */
  private channelPacks(product: Product): ChannelPack[] | null {
    if (product.kind !== 'voices' || !this.channel || !product.folders || product.folders.length === 0) return null
    const packs = product.folders.map((f) => this.channel!.packs[f])
    return packs.every((p) => !!p) ? (packs as ChannelPack[]) : null
  }

  /** The highest `requires.Spoken` among a product's channel folders, as `3.1.0`. */
  private requiredSpoken(product: Product): string | null {
    const versions = (this.channelPacks(product) ?? []).map((p) => p.requires.Spoken.slice(2))
    return versions.sort((a, b) => compareVersions(a, b) ?? 0).at(-1) ?? null
  }

  /** What an update of a channel product would download, judged from the cached manifests; null when one is missing. */
  private deltaOf(game: GameInstall, product: Product, packs: ChannelPack[]): { files: number; bytes: number } | null {
    let files = 0
    let bytes = 0
    for (const [i, f] of product.folders!.entries()) {
      const manifest = loadCachedManifest(this.opts.dataPath, f, packs[i]!, this.opts.packsPublicKey)
      if (!manifest) return null
      const d = estimatePack(manifest, loadPackState(game, f))
      files += d.files
      bytes += d.bytes
    }
    return { files, bytes }
  }

  /** Installs the newest Spoken release when the installed one is older than the pack needs; refuses when none is new enough. */
  private async ensureSpoken(game: GameInstall, product: Product, ctx: JobContext): Promise<void> {
    const need = this.requiredSpoken(product)
    if (!need) return
    const spoken = (await computeStatuses(game, this.effectiveCatalog(), this.settings, loadState(this.opts.dataPath), [productById('spoken')!]))[0]
    if (spoken?.installedVersion && (compareVersions(spoken.installedVersion, need) ?? -1) >= 0) return
    const release = this.pickRelease('spoken')
    if (!release || (compareVersions(release.version, need) ?? -1) < 0) {
      throw new PlainError(`${product.title} needs Spoken ${need} or newer, which is not released yet.`)
    }
    // Spoken's own 'done' would end the pack's job, so it is reported as a step of the pack's job.
    const inner: JobContext = {
      ...ctx,
      emit: (p) => ctx.emit({ ...p, productId: product.id, phase: p.phase === 'done' ? 'installing' : p.phase, ...(p.phase === 'done' ? { message: 'Spoken is up to date.' } : {}) })
    }
    await installProduct(game, productById('spoken')!, release, inner)
  }

  private async syncChannel(game: GameInstall, product: Product, ctx: JobContext, repair: boolean): Promise<void> {
    const packs = this.channelPacks(product)
    if (!packs) throw new PlainError(`${product.title} is not on the voice pack server right now. Press refresh and try again.`)
    const opts = this.channelOptions(ctx.signal)
    const manifests = await Promise.all(packs.map((p, i) => fetchManifest(this.opts.dataPath, product.folders![i]!, p, opts)))
    await this.ensureSpoken(game, product, ctx)
    await syncPacks(game, { product, manifests, baseUrl: this.packsBase(), repair }, ctx)
  }

  private findProduct(productId: string): Product | undefined {
    return this.allProducts().find((p) => p.id === productId)
  }

  // ---------------------------------------------------------------- statuses

  async statuses(gameId: string): Promise<ProductStatus[]> {
    const game = this.requireGame(gameId)
    const state = loadState(this.opts.dataPath)
    const products = this.allProducts()
    // A pack installed earlier and since removed from the registry still shows, so it can be removed.
    for (const id of Object.keys(state.installs[gameId] ?? {})) {
      if (isCommunityProductId(id) && !products.some((p) => p.id === id)) {
        products.push(communityProduct({ id: id.slice(COMMUNITY_PREFIX.length) }))
      }
    }
    const out = await computeStatuses(game, this.effectiveCatalog(), this.settings, state, products)
    const spoken = out.find((s) => s.productId === 'spoken')?.installedVersion
    for (const status of out) {
      if (!isChannelRelease(status.latest)) continue
      const product = products.find((p) => p.id === status.productId)!
      const need = this.requiredSpoken(product)
      if (need && (!spoken || (compareVersions(spoken, need) ?? -1) < 0)) status.needsSpoken = need
      if (status.state !== 'update-available') continue
      const packs = this.channelPacks(product)
      const delta = packs && this.deltaOf(game, product, packs)
      if (delta && delta.files > 0) status.delta = delta
    }
    return out
  }

  // ---------------------------------------------------------------- jobs

  private pickRelease(productId: string, version?: string): ReleaseInfo | undefined {
    const catalog = this.effectiveCatalog()
    if (version) return (catalog.releases[productId] ?? []).find((r) => r.version === version)
    return latestFor(catalog, productId, this.settings.includePrereleases || productId.startsWith(COMMUNITY_PREFIX))
  }

  private jobContext(jobId: string, signal: AbortSignal, emit: (p: JobProgress) => void) {
    return {
      jobId,
      dataPath: this.opts.dataPath,
      downloadsPath: this.downloadsPath(),
      keepDownloads: this.settings.keepDownloads,
      signal,
      emit,
      userAgent: `SpokenManager/${this.opts.appVersion}`,
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(this.opts.ops ? { ops: this.opts.ops } : {}),
      ...(this.opts.isRunning ? { isRunning: this.opts.isRunning } : {}),
      ...(this.opts.backoffMs !== undefined ? { backoffMs: this.opts.backoffMs } : {})
    }
  }

  /** The release of the version that is installed, for a repair. */
  private async releaseToRepair(gameId: string, product: Product): Promise<ReleaseInfo> {
    const status = (await this.statuses(gameId)).find((s) => s.productId === product.id)
    if (!status || status.installedFolders.length === 0) throw new PlainError(`${product.title} is not installed, so there is nothing to repair. Install it instead.`)
    const version = status.installedVersion
    const release = version ? this.pickRelease(product.id, version) : undefined
    if (!release) {
      throw new PlainError(
        version
          ? `Version ${version} of ${product.title} is no longer in the list of releases, so it cannot be put back. Update it instead.`
          : `The installed version of ${product.title} is not known, so it cannot be put back. Update it instead.`
      )
    }
    return release
  }

  install(gameId: string, productId: string, options?: InstallOptions): string {
    const game = this.requireGame(gameId)
    const product = this.findProduct(productId)
    if (!product) throw new Error('Unknown product')
    const refused = isSupportedFlavor(game.flavor) ? null : notSupportedMessage(game.flavorFolder)
    const repair = options?.repair === true
    const wanted = repair ? undefined : options?.version
    const release = repair ? undefined : this.pickRelease(productId, wanted)
    const channel = channelRelease(product, this.channel, this.packsBase())
    return this.jobs.enqueue({
      gameId,
      productId,
      action: repair ? 'repair' : 'install',
      ...(release ? { version: release.version } : {}),
      run: async (ctx) => {
        if (refused) throw new PlainError(refused)
        if (channel && !wanted) {
          await this.syncChannel(game, product, this.jobContext(ctx.jobId, ctx.signal, ctx.emit), repair)
          return
        }
        if (repair) {
          const again = await this.releaseToRepair(game.id, product)
          this.dropChannelState(game, product)
          await installProduct(game, product, again, { ...this.jobContext(ctx.jobId, ctx.signal, ctx.emit), repair: true })
          return
        }
        if (!release) {
          throw new PlainError(
            wanted
              ? `Version ${wanted} of ${product.title} is not in the list of releases.`
              : this.catalog.fetchedAt
                ? `There is no release of ${product.title} to install yet.`
                : 'The list of releases has not been loaded yet. Check your connection, press refresh and try again.'
          )
        }
        this.dropChannelState(game, product)
        await installProduct(game, product, release, this.jobContext(ctx.jobId, ctx.signal, ctx.emit))
      }
    })
  }

  /**
   * Before a zip from GitHub replaces a voice product's folders: the channel revs recorded for them would
   * no longer describe what is installed. Dropped first rather than after, so no status can see them in
   * between; if the install fails, the folders are only hashed again on the next channel sync.
   */
  private dropChannelState(game: GameInstall, product: Product): void {
    if (product.kind === 'voices') for (const f of product.folders ?? []) dropPackState(game, f)
  }

  uninstall(gameId: string, productId: string): string {
    const game = this.requireGame(gameId)
    let product = this.findProduct(productId)
    // A community pack that left the registry can still be removed.
    if (!product && isCommunityProductId(productId)) product = communityProduct({ id: productId.slice(COMMUNITY_PREFIX.length) })
    if (!product) throw new Error('Unknown product')
    const target = product
    const refused = isSupportedFlavor(game.flavor) ? null : notSupportedMessage(game.flavorFolder)
    return this.jobs.enqueue({
      gameId,
      productId,
      action: 'uninstall',
      run: async (ctx) => {
        if (refused) throw new PlainError(refused)
        const result = await uninstallProduct(game, target, this.jobContext(ctx.jobId, ctx.signal, ctx.emit))
        if (target.kind === 'voices') for (const f of result.removed) dropPackState(game, f)
      }
    })
  }

  /** Deletes the kept zips; not while a download or install runs. */
  async clearDownloads(): Promise<ClearDownloadsResult> {
    if (this.jobs.active().length > 0) throw new PlainError('Wait for the running downloads and installs to finish first.')
    return clearDownloads(this.downloadsPath())
  }

  cancel(jobId: string): void {
    this.jobs.cancel(jobId)
  }

  // ---------------------------------------------------------------- sharing

  /** Looks at the files now and every SHARE_POLL_MS; each look sends only when sharing is on. */
  startSharing(): void {
    if (this.shareTimer) return
    this.shareTimer = setInterval(() => void this.shareTick(false), SHARE_POLL_MS)
    this.shareTimer.unref?.()
    void this.ready.then(() => this.shareTick(false))
  }

  /** "Send now": reads every file, whatever the backoff says. The status arrives on sharingChanged. */
  async sendNow(): Promise<void> {
    if (this.settings.sharing !== 'on') throw new PlainError('Turn on Sharing first.')
    await this.sharing?.done
    await this.shareTick(true)
  }

  /** A new random id for this manager; the lines already sent are not sent again. */
  resetShareId(): void {
    resetInstallId(this.opts.dataPath, this.ledger)
  }

  private setSharingStatus(next: SharingStatus): void {
    this.sharingStatus = next
    this.opts.send(CHANNELS.sharingChanged, next)
  }

  /** Off stops a send at once; on sends what is there now rather than at the next poll. */
  private sharingChanged(was: SharingChoice): void {
    const now = this.settings.sharing
    if (was === 'on' && now !== 'on') this.sharing?.abort.abort()
    if (was !== 'on' && now === 'on') {
      this.shareFailures = 0
      this.shareRetryAt = 0
      void this.shareTick(true)
    }
  }

  /** One send, unless one runs, sharing is off, or a failure's wait has not passed. */
  async shareTick(force: boolean): Promise<SendResult | null> {
    if (this.settings.sharing !== 'on' || this.sharing) return null
    if (!force && Date.now() < this.shareRetryAt) return null
    const abort = new AbortController()
    const done = this.share(abort.signal, force).finally(() => {
      this.sharing = null
    })
    this.sharing = { abort, done }
    return done
  }

  private async share(signal: AbortSignal, all: boolean): Promise<SendResult | null> {
    this.setSharingStatus({ ...this.sharingStatus, sending: true })
    let result: SendResult | null = null
    try {
      result = await sendPending({
        dataPath: this.opts.dataPath,
        ledger: this.ledger,
        games: this.games.filter((g) => isSupportedFlavor(g.flavor)),
        appVersion: this.opts.appVersion,
        signal,
        all,
        ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
        ...(this.opts.shareUrl ? { url: this.opts.shareUrl } : {})
      })
    } catch (err) {
      if (!signal.aborted) log('Sharing failed:', err)
    }
    const { error: _old, ...status } = this.sharingStatus
    const next: SharingStatus = { ...status, sending: false, ...(this.ledger.lastSent ? { lastSent: this.ledger.lastSent } : {}) }
    if (result && (result.outcome === 'sent' || result.outcome === 'nothing')) {
      this.shareFailures = 0
      this.shareRetryAt = 0
      if (result.outcome === 'sent') log(`Sharing: sent ${result.count} line(s).`)
    } else if (result) {
      const wait = SHARE_BACKOFF_MS[Math.min(this.shareFailures, SHARE_BACKOFF_MS.length - 1)]!
      this.shareFailures++
      this.shareRetryAt = Date.now() + wait
      next.error = result.outcome === 'rate-limited' ? 'The site asked to wait. Spoken will try again later.' : result.error
      log(`Sharing: ${result.outcome}${result.outcome === 'failed' ? `: ${result.error}` : ''}; next try in ${Math.round(wait / 60000)} min.`)
    }
    this.setSharingStatus(next)
    return result
  }

  // ---------------------------------------------------------------- generating

  private requireGenerating(): Generating {
    if (!this.generating) throw new PlainError('This computer has no keychain to keep the keys in, so the Manager cannot generate here.')
    return this.generating
  }

  /** Starts the loop when Generating is on; called once at start. */
  startGenerating(): void {
    if (this.settings.generating) this.generating?.start()
    else void this.generating?.refresh()
  }

  async generatePair(): Promise<void> {
    await this.requireGenerating().pair()
  }

  async generateUnpair(): Promise<void> {
    await this.requireGenerating().unpair()
  }

  generateSetKey(provider: 'elevenlabs' | 'fish', key: string): void {
    this.requireGenerating().setKey(provider, key)
  }

  // ---------------------------------------------------------------- settings

  setSettings(patch: Partial<Settings>): Settings {
    const clean: Partial<Settings> = {}
    const merged = sanitizeSettings(patch, this.settings)
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      if (key in merged) (clean as Record<string, unknown>)[key] = merged[key]
    }
    if (typeof clean.downloadsPath === 'string') {
      const problem = checkDownloadsPath(clean.downloadsPath, this.games)
      if (problem) throw new PlainError(problem)
    }
    const wasSharing = this.settings.sharing
    this.settings = { ...this.settings, ...clean }
    try {
      saveSettings(this.opts.dataPath, this.settings)
    } catch (err) {
      log('Could not save the settings:', err)
    }
    this.sharingChanged(wasSharing)
    if (clean.generating === true) this.generating?.start()
    if (clean.generating === false) this.generating?.stop()
    return this.settings
  }
}

// The contract between the window and the main process. The preload exposes `ManagerApi` as
// `window.manager`; the main process answers each channel.
import type { Catalog, CommunityCatalog, ContributorView, GameInstall, JobProgress, ProductStatus, ReleaseRow, Settings, SharingStatus, Snapshot, StoreId } from './types'

export const CHANNELS = {
  snapshot: 'manager:snapshot',
  scanGames: 'manager:games:scan',
  addGame: 'manager:games:add',
  removeGame: 'manager:games:remove',
  refreshCatalog: 'manager:catalog:refresh',
  refreshCommunity: 'manager:community:refresh',
  statuses: 'manager:statuses',
  install: 'manager:install',
  uninstall: 'manager:uninstall',
  cancel: 'manager:cancel',
  setSettings: 'manager:settings:set',
  pickFolder: 'manager:pick-folder',
  openPath: 'manager:open-path',
  openExternal: 'manager:open-external',
  openLogs: 'manager:open-logs',
  checkManagerUpdate: 'manager:updater:check',
  restartManager: 'manager:updater:restart',
  clearDownloads: 'manager:downloads:clear',
  shareNow: 'manager:sharing:send',
  resetShareId: 'manager:sharing:reset-id',
  contributorView: 'manager:contributor:view',
  contributorSignIn: 'manager:contributor:sign-in',
  contributorSignOut: 'manager:contributor:sign-out',
  contributorSaveStore: 'manager:contributor:save-store',
  contributorRows: 'manager:contributor:rows',
  contributorPublish: 'manager:contributor:publish',
  windowMinimize: 'manager:window:minimize',
  windowToggleMaximize: 'manager:window:toggle-maximize',
  windowClose: 'manager:window:close',
  windowIsMaximized: 'manager:window:is-maximized',
  // main -> window
  jobProgress: 'manager:event:job',
  gamesChanged: 'manager:event:games',
  catalogChanged: 'manager:event:catalog',
  communityChanged: 'manager:event:community',
  updaterState: 'manager:event:updater',
  sharingChanged: 'manager:event:sharing',
  contributorChanged: 'manager:event:contributor',
  windowMaximized: 'manager:event:window-maximized'
} as const

export interface AddGameResult {
  /** The install that was added (or already known), or why not. */
  game?: GameInstall
  error?: string
}

export interface InstallOptions {
  /** A version other than the newest, e.g. to go back. */
  version?: string
  /** Put the installed version back: the same download and install, over what is there. Ignores `version`. */
  repair?: boolean
}

export interface ClearDownloadsResult {
  /** Zip and part files deleted from the downloads folder. */
  files: number
  bytes: number
}

export type UpdaterState =
  | { state: 'idle' }
  | { state: 'checking' }
  /** `url`: where to download it, when this system cannot update the manager by itself (macOS without signing). */
  | { state: 'available'; version: string; url?: string }
  | { state: 'downloading'; percent: number }
  /** `message`: installing it failed; pressing Restart again may still work. */
  | { state: 'ready'; version: string; message?: string }
  | { state: 'error'; message: string }

/** What a store form sends. A token is write-only: the window can set it but never read it back. */
export interface StoreInput {
  store: StoreId
  /** Empty removes the saved token; absent keeps it. */
  token?: string
  projects?: Record<string, string>
  repo?: string
  gameVersions?: string
}

export interface ManagerApi {
  /** Everything the window needs to draw its first frame. */
  snapshot(): Promise<Snapshot>
  /** Looks again for WoW installs; returns the list (manual ones kept). */
  scanGames(): Promise<GameInstall[]>
  /** Adds a folder by hand: the game folder, a flavor folder, or an AddOns folder. */
  addGame(path: string): Promise<AddGameResult>
  removeGame(gameId: string): Promise<GameInstall[]>
  /** Asks GitHub for the releases (ETag-cached); `force` skips the cache window. */
  refreshCatalog(force?: boolean): Promise<Catalog>
  /** Reads the community registry (ETag-cached). A pack installs, updates and uninstalls through
   *  the ordinary `install`/`uninstall`/`statuses` with the product id `community/<pack id>`. */
  refreshCommunity(force?: boolean): Promise<CommunityCatalog>
  /** What is installed and what is new, for each product, on one game. */
  statuses(gameId: string): Promise<ProductStatus[]>
  /** Starts a download and install; the progress comes through `onJob`. Returns the job id. */
  install(gameId: string, productId: string, options?: InstallOptions): Promise<string>
  /** Removes the folders the manager installed for a product. */
  uninstall(gameId: string, productId: string): Promise<string>
  cancel(jobId: string): Promise<void>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  /** The system folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>
  openPath(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  openLogs(): Promise<void>
  /**
   * Asks for a newer manager now. Progress and failures come through `onUpdater`.
   * `background`: respects the auto-update setting and only logs a failure.
   */
  checkManagerUpdate(background?: boolean): Promise<void>
  /** Installs the ready update and starts the new version. Does nothing while a job runs. */
  restartManager(): Promise<void>
  /** Deletes the downloaded zips (and half-finished ones) kept in the downloads folder. Refused while a job runs. */
  clearDownloads(): Promise<ClearDownloadsResult>
  /** Sends the collected lines now. Refused while Sharing is off. */
  /** The status comes through onSharing. */
  shareNow(): Promise<void>
  /** Gives this manager a new random id. */
  resetShareId(): Promise<void>
  /** The signed-in account and the stores' settings, with no secret in it. */
  contributorView(): Promise<ContributorView>
  contributorSignIn(email: string, password: string): Promise<ContributorView>
  contributorSignOut(): Promise<ContributorView>
  contributorSaveStore(input: StoreInput): Promise<ContributorView>
  contributorRows(gameId: string, lang: string, store: StoreId): Promise<ReleaseRow[]>
  /** Starts a release of a language's packs, or of the one folder `only`; progress comes through `onJob`
   *  and `cancel` stops it. Returns the job id. */
  contributorPublish(gameId: string, lang: string, store: StoreId, only?: string): Promise<string>
  /** The window has no system title bar, so the page draws its own buttons and calls these. */
  windowMinimize(): Promise<void>
  /** Maximizes the window, or puts it back when it is already maximized. */
  windowToggleMaximize(): Promise<void>
  windowClose(): Promise<void>
  windowIsMaximized(): Promise<boolean>

  onJob(listener: (progress: JobProgress) => void): () => void
  onGamesChanged(listener: (games: GameInstall[]) => void): () => void
  onCatalogChanged(listener: (catalog: Catalog) => void): () => void
  onCommunityChanged(listener: (community: CommunityCatalog) => void): () => void
  onUpdater(listener: (state: UpdaterState) => void): () => void
  onSharing(listener: (status: SharingStatus) => void): () => void
  onContributorChanged(listener: (view: ContributorView) => void): () => void
  /** True when the window becomes maximized, false when it is put back. */
  onWindowMaximized(listener: (maximized: boolean) => void): () => void
}

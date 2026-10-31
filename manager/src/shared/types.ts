// The one file the main process and the window both import: what the app talks about.

/** The game versions Spoken runs on, by their folder: `_forever_` (Forever), `_classic_era_`, `_anniversary_`. */
export type Flavor = 'forever' | 'classic_era' | 'anniversary'

/** One World of Warcraft install: a flavor folder such as `...\World of Warcraft\_forever_`. */
export interface GameInstall {
  /** Stable id: the first 12 hex digits of sha1(lower-cased `root`). */
  id: string
  /** The flavor folder. */
  root: string
  /** `<root>\Interface\AddOns`; may not exist yet. */
  addOnsPath: string
  /** `_forever_`. */
  flavorFolder: string
  flavor: Flavor
  /** The Blizzard product code from `.build.info` / `.flavor.info`, e.g. `wow_forever`. */
  product: string
  /** What the player calls it: "WoW: Forever", "WoW: Classic Era", "WoW: Anniversary". */
  label: string
  /** `1.60.1.70450`, when `.build.info` says. */
  gameVersion?: string
  /** Found by the scan, or added by hand. */
  source: 'auto' | 'manual'
  /** Whether the AddOns folder (or its parent) can be written to. */
  writable: boolean
}

/**
 * The game versions Spoken runs on, as publishers/spoken/spoken.md says: made and tested on
 * Forever (`_forever_`), and installs on Classic Era and Anniversary. The scan lists no other.
 */
export const SUPPORTED_FLAVORS: Flavor[] = ['forever', 'classic_era', 'anniversary']

/** `_forever_, _classic_era_ or _anniversary_`, for the texts that tell the player which folder to pick. */
export const FLAVOR_FOLDER_LIST = SUPPORTED_FLAVORS.map((f) => `_${f}_`).join(', ').replace(/, ([^,]*)$/, ' or $1')

export function isSupportedFlavor(flavor: Flavor): boolean {
  return SUPPORTED_FLAVORS.includes(flavor)
}

export type Section = 'quests' | 'places' | 'readables' | 'bosses'
export type QuestsPack = 'all' | 'alliance' | 'horde' | 'shared' | 'gossip'

/** What can be installed: Spoken itself, or a voice pack. A static table (shared/products.ts). */
export interface Product {
  /** `spoken`, `quests-audio`, `quests-audio-alliance`, `places-audio-deDE`, ... (the release tag prefix). */
  id: string
  kind: 'addon' | 'voices' | 'community'
  /** "Spoken","Quests voices", "Places voices", "Readables voices", "Bosses voices". */
  title: string
  /** One line for the card. */
  description: string
  section?: Section
  /** `enUS`, `deDE`, ... for a voice pack. */
  lang?: string
  /** For English quests packs: which of the five. A language's quests pack is `all`. */
  pack?: QuestsPack
  /** The release tag is `<id>/v<version>`. */
  tagPrefix: string
  /** Folders the zip installs, when known in advance (voice packs). Spoken's come from the zip itself. */
  folders: string[] | null
  /** Regular-expression source an asset name must match (the zip). */
  assetPattern: string
  /**
   * What the pack was released as before its section was renamed (Places was zones-audio and
   * SpokenZonesAudio, Readables books-audio and SpokenBooksAudio): its releases still count, its
   * folder is still this product's, and installing the new one moves it to the backup.
   */
  legacy?: { id: string; tagPrefix: string; folders: string[]; assetPattern: string }
}

/**
 * One voice pack made by a player, as listed in `community/packs.json` of the repo. Added by
 * pull request, so a maintainer has looked at it. Installs as the folder `SpokenCommunity_<id>`.
 */
export interface CommunityPack {
  /** Lower-case letters, digits and hyphens: `elune-quests-deDE`. Unique in the registry. */
  id: string
  title: string
  /** The player or group that made it. */
  author: string
  description: string
  /** `enUS`, `deDE`, ... */
  lang: string
  section: Section
  version: string
  /** Bytes of the zip. */
  size: number
  /** Required. The download is refused when it does not match. */
  sha256: string
  /** An https GitHub release asset (github.com/<owner>/<repo>/releases/download/...). */
  url: string
  /** Where the author talks about it (an https link), if anywhere. */
  homepage?: string
  /** `CC-BY-4.0`, `All rights reserved`, ... as the author states it. */
  license?: string
  /** `2026-10-18`. */
  addedAt: string
}

/** The folder a community pack installs as. */
export function communityFolder(id: string): string {
  return `SpokenCommunity_${id}`
}

export interface CommunityCatalog {
  fetchedAt: string | null
  /** The last fetch failed and this is what was kept. */
  offline: boolean
  error?: string
  packs: CommunityPack[]
}

/** One GitHub release of a product. */
export interface ReleaseInfo {
  productId: string
  tag: string
  /** `3.5.0`, `3.5.0-alpha.1`. */
  version: string
  prerelease: boolean
  publishedAt: string
  /** The release notes, markdown. */
  notes: string
  assetName: string
  assetSize: number
  assetUrl: string
  /** `sha256:<hex>` from GitHub, when it gives one. */
  digest?: string
  htmlUrl: string
}

export type InstallState =
  /** Nothing of it is installed. */
  | 'not-installed'
  | 'up-to-date'
  | 'update-available'
  /** Installed, newer than anything released (a development build, or a pre-release not offered). */
  | 'ahead'
  /** Its folders are junctions or symlinks: a developer's checkout. Never touched. */
  | 'linked'
  /** Installed by hand, or by another tool, and no release is known to compare. */
  | 'unknown'

/** What is installed for one product on one game, and what could be. */
export interface ProductStatus {
  gameId: string
  productId: string
  state: InstallState
  /** The version in the folder's `.toc`, or the one the manager recorded. */
  installedVersion?: string
  /** The folders found on disk. */
  installedFolders: string[]
  /** The newest release for the player's channel, if the catalog is known. */
  latest?: ReleaseInfo
  /** For a channel pack with an update: what it would download, judged from what was recorded. */
  delta?: { files: number; bytes: number }
  /** For a channel pack: the Spoken version it needs, when the one installed is older or missing. */
  needsSpoken?: string
  /** Why nothing may be done (`linked`, not writable, ...). */
  blockedReason?: string
}

export interface Settings {
  includePrereleases: boolean
  checkOnStart: boolean
  /** The manager's own updates. */
  autoUpdateManager: boolean
  /** Where downloads are kept; empty means the app's own folder. */
  downloadsPath: string
  keepDownloads: boolean
  /** The language chosen on the Voice Packs page. */
  voiceLanguage: string
  /** The game last looked at. */
  lastGameId: string
  /** Sending what Spoken collects to the site: 'unset' until the player answers the first-start question. */
  sharing: SharingChoice
}

export const SHARING_CHOICES = ['unset', 'on', 'off'] as const

export type SharingChoice = (typeof SHARING_CHOICES)[number]

/** What the window shows of sharing. The install id stays in the main process. */
export interface SharingStatus {
  /** The last send that the site took: when, and how many lines. */
  lastSent?: { at: string; count: number }
  /** A send is running now. */
  sending: boolean
  /** Why the last attempt failed, in plain words, until one succeeds. */
  error?: string
}

export const DEFAULT_SETTINGS: Settings = {
  includePrereleases: false,
  checkOnStart: true,
  autoUpdateManager: true,
  downloadsPath: '',
  keepDownloads: false,
  voiceLanguage: 'enUS',
  lastGameId: '',
  sharing: 'unset'
}

/** The settings that take only some values of their type; anything else is dropped on load. */
export const SETTING_CHOICES: Partial<Record<keyof Settings, readonly unknown[]>> = {
  sharing: SHARING_CHOICES
}

/** The release lists the catalog holds, by product id, newest first. */
export interface Catalog {
  fetchedAt: string | null
  /** The last fetch failed and this is what was kept. */
  offline: boolean
  /** Why it failed, for the log. */
  error?: string
  releases: Record<string, ReleaseInfo[]>
}

export type JobPhase =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'installing'
  | 'done'
  | 'error'
  | 'cancelled'

export interface JobProgress {
  jobId: string
  gameId: string
  productId: string
  /** A repair is an install of the version already there. */
  action: 'install' | 'repair' | 'uninstall'
  phase: JobPhase
  /** Bytes of the download so far and its total. */
  received: number
  total: number
  bytesPerSecond: number
  /** The version being installed. */
  version?: string
  /** Plain words for the window: the error, or "Reload or restart the game". */
  message?: string
}

export interface Snapshot {
  games: GameInstall[]
  settings: Settings
  catalog: Catalog
  community: CommunityCatalog
  products: Product[]
  appVersion: string
  /** The operating system the manager runs on: the window's frame and the game search differ. */
  platform: 'win32' | 'darwin' | 'linux'
  /** Where state, logs and downloads are kept. */
  dataPath: string
  /** The manager's own update, as last sent: a window opened later still shows it. */
  updater?: import('./api').UpdaterState
  sharingStatus?: SharingStatus
}

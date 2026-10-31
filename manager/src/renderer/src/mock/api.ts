// A believable fake ManagerApi, used only when `window.manager` is missing (a plain browser:
// `npm run dev:web`). Address options: ?offline=1, ?empty=1 (no games), ?empty=packs (an empty community
// list), ?readonly=1 (Anniversary is read-only), ?missing=anniversary (that game was not found; also forever, era), ?linked=1 (Spoken on Anniversary is a link to a development folder), ?update=1 (a manager update banner), ?update=url (an update to download in the browser), ?platform=darwin|linux|win32 (the window frame of that system), ?sharing=on|off (the first-start question already answered).
import type { AddGameResult, InstallOptions, ManagerApi, UpdaterState } from '@shared/api'
import { PRODUCTS, SPOKEN_FOLDERS, productById } from '@shared/products'
import type { Catalog, CommunityCatalog, CommunityPack, GameInstall, GenerateStatus, JobProgress, Product, ProductStatus, ReleaseInfo, Settings, SharingStatus, Snapshot } from '@shared/types'
import { DEFAULT_SETTINGS, FLAVOR_FOLDER_LIST, communityFolder } from '@shared/types'
import { compareVersions } from '@shared/version'

const MB = 1024 * 1024

const SPOKEN_350 = `- **Readables finds and reads pages only a language pack has.** A page that exists in your client's
  language but not in English, such as one a player sent in, is now recognised, placed in its
  book and read aloud once its language pack carries it, and Report works on it.
  *([rusty-key](https://github.com/rusty-key))*
- **The minimap button's tooltip shows Spoken's version.** It sits above the click hints, where
  a bug report can quote it without opening the settings.
  *([anon1231823](https://github.com/anon1231823))*
- **An NPC that comes in several races under one name now speaks in the voice of the race you
  see.** The Ironforge Reveler, for one, is a dwarf, a gnome or a human, and spoke with only one
  voice; it speaks in each now, once its packs have that voice.
  *([rusty-key](https://github.com/rusty-key))*
- **Spoken Contributions has its own icon in the AddOns list**, a heart, rather than none, and its
  name is no longer greyed out.
  *([Nucabe](https://github.com/Nucabe))*`

const SPOKEN_ALPHA = `## Testing

- **Read Greetings reads each new greeting once, not each NPC.** The setting is now Once per
  Greeting: each line plays the first time you see it. Greetings heard before this update play once more.
- Report files a line under the voice language you chose.

Please report problems on [GitHub](https://github.com/rusty-key/spoken-wow/issues).`

const SPOKEN_340 = `- **Gossip is read in the NPC's own voice again.** After a talk with a trainer the greeting used
  the narrator's voice for a moment. It now waits for the NPC's line.
  *([rusty-key](https://github.com/rusty-key))*
- **Text Size and Lines apply at once.** No \`/reload\` is needed after changing them in the
  settings window.
  *([Nucabe](https://github.com/Nucabe))*
- Fixed a rare error when the map was opened before the first quest was read.`

const SPOKEN_335 = `- **Stop** now also clears what is waiting in the queue, not only the line being read.
- The narrator window remembers where you left it, per character.
- Fixed *Replay* playing the previous quest when two were accepted in a row.`

type Row = [version: string, date: string, sizeMB: number, notes?: string]

const TABLE: Record<string, Row[]> = {
  spoken: [
    ['3.5.0', '2026-10-17', 38, SPOKEN_350],
    ['3.5.0-alpha.1', '2026-10-12', 38, SPOKEN_ALPHA],
    ['3.4.0', '2026-10-02', 36, SPOKEN_340],
    ['3.3.5', '2026-09-21', 35, SPOKEN_335]
  ],
  'quests-audio': [
    ['2.4.0', '2026-10-09', 1433, 'All quests, Alliance, Horde, Shared and Gossip in one download.\n\n- 212 new recordings for the Eastern Plaguelands.'],
    ['2.3.0', '2026-09-18', 1390]
  ],
  'quests-audio-alliance': [['2.4.0', '2026-10-09', 573]],
  'quests-audio-horde': [['2.4.0', '2026-10-09', 531]],
  'quests-audio-shared': [['2.4.0', '2026-10-09', 134]],
  'quests-audio-gossip': [['2.4.0', '2026-10-09', 195]],
  'places-audio': [['2.3.1', '2026-10-05', 312]],
  'readables-audio': [['1.2.0', '2026-09-30', 181]],
  'quests-audio-deDE': [['1.8.0', '2026-10-08', 982, '- 96 quests re-recorded.\n- New: gossip of the Durotar vendors.']],
  'places-audio-deDE': [
    ['2.1.1', '2026-10-11', 450, 'Fixes a wrong line for Gadgetzan.'],
    ['2.1.0', '2026-10-03', 447]
  ],
  'readables-audio-deDE': [['1.1.0', '2026-10-01', 143]],
  'quests-audio-frFR': [['1.6.0', '2026-10-06', 871]],
  'places-audio-frFR': [['1.0.2', '2026-10-04', 398]],
  'quests-audio-esES': [['1.2.0', '2026-09-27', 702]],
  'places-audio-esES': [['1.0.0', '2026-09-27', 301]],
  'quests-audio-itIT': [['0.9.0', '2026-10-10', 384]],
  'quests-audio-ruRU': [['1.1.0', '2026-10-02', 640]],
  'quests-audio-koKR': [['0.8.0-beta.1', '2026-10-13', 410, 'First beta of the Korean quest voices.']]
}

function release(productId: string, [version, date, sizeMB, notes]: Row): ReleaseInfo {
  const p = productById(productId)
  const tag = `${productId}/v${version}`
  const base = productId === 'spoken' ? 'Spoken' : productId === 'quests-audio' ? 'SpokenQuestsAudioAll' : (p?.folders?.[0] ?? productId)
  const asset = `${base}-${version}.zip`
  return {
    productId,
    tag,
    version,
    prerelease: /-/.test(version),
    publishedAt: `${date}T16:20:00Z`,
    notes: notes ?? '',
    assetName: asset,
    assetSize: Math.round(sizeMB * MB),
    assetUrl: `https://github.com/rusty-key/spoken-wow/releases/download/${tag}/${asset}`,
    htmlUrl: `https://github.com/rusty-key/spoken-wow/releases/tag/${tag}`
  }
}

function buildReleases(): Record<string, ReleaseInfo[]> {
  const out: Record<string, ReleaseInfo[]> = {}
  for (const [id, rows] of Object.entries(TABLE)) out[id] = rows.map((r) => release(id, r))
  return out
}

const SHA = '0'.repeat(64)
const pack = (p: Omit<CommunityPack, 'sha256' | 'url' | 'addedAt'>): CommunityPack => ({
  sha256: SHA,
  url: `https://github.com/example/${p.id}/releases/download/v${p.version}/${communityFolder(p.id)}-${p.version}.zip`,
  addedAt: '2026-10-12',
  ...p
})

const COMMUNITY_PACKS: CommunityPack[] = [
  pack({
    id: 'elune-quests-deDE',
    title: 'Elune: Quests auf Deutsch',
    author: 'Elune Voices',
    description: 'Every Eastern Kingdoms quest read by a small cast of German volunteers.',
    lang: 'deDE',
    section: 'quests',
    version: '1.2.0',
    size: 412 * MB,
    homepage: 'https://github.com/example',
    license: 'CC-BY-4.0'
  }),
  pack({
    id: 'mirelle-places-frFR',
    title: 'Mirelle: Les lieux de Kalimdor',
    author: 'Mirelle',
    description: 'The story of each Kalimdor zone, told by one voice.',
    lang: 'frFR',
    section: 'places',
    version: '0.9.1',
    size: 138 * MB,
    homepage: 'https://example.org/mirelle',
    license: 'CC-BY-NC-4.0'
  }),
  pack({
    id: 'tomes-aloud-enUS',
    title: 'Tomes Aloud',
    author: 'Brannic and friends',
    description: 'Books, letters and notes in a dwarven accent.',
    lang: 'enUS',
    section: 'readables',
    version: '2.0.0',
    size: 96 * MB,
    license: 'All rights reserved'
  }),
  pack({
    id: 'sombra-quests-esMX',
    title: 'Sombra: Misiones en español',
    author: 'Sombra',
    description: 'Quest voices for the Barrens and Stranglethorn.',
    lang: 'esMX',
    section: 'quests',
    version: '0.4.0',
    size: 233 * MB,
    homepage: 'http://insecure.example/sombra'
  }),
  pack({
    id: 'north-places-ruRU',
    title: 'Север: Зоны Нортренда',
    author: 'Север',
    description: 'Zone stories for Northrend, in Russian.',
    lang: 'ruRU',
    section: 'places',
    version: '1.1.0',
    size: 187 * MB,
    homepage: 'https://example.org/sever',
    license: 'MIT'
  })
]

/** The pack as a product and a release, so the ordinary install path works on it. */
function communityProduct(pk: CommunityPack): Product {
  return {
    id: `community/${pk.id}`,
    kind: 'community',
    title: pk.title,
    description: pk.description,
    section: pk.section,
    lang: pk.lang,
    tagPrefix: `community/${pk.id}`,
    folders: [communityFolder(pk.id)],
    assetPattern: '.*'
  }
}

function communityRelease(pk: CommunityPack): ReleaseInfo {
  const asset = `${communityFolder(pk.id)}-${pk.version}.zip`
  return {
    productId: `community/${pk.id}`,
    tag: `v${pk.version}`,
    version: pk.version,
    prerelease: false,
    publishedAt: `${pk.addedAt}T10:00:00Z`,
    notes: '',
    assetName: asset,
    assetSize: pk.size,
    assetUrl: pk.url,
    htmlUrl: pk.homepage ?? pk.url
  }
}

function game(root: string, flavorFolder: string, flavor: GameInstall['flavor'], product: string, label: string, gameVersion: string): GameInstall {
  return {
    id: Array.from(root).reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0') + 'a1b2',
    root,
    addOnsPath: `${root}\\Interface\\AddOns`,
    flavorFolder,
    flavor,
    product,
    label,
    gameVersion,
    source: 'auto',
    writable: true
  }
}

interface Installed {
  version: string
  folders: string[]
  linked?: boolean
}

const WOW = 'C:\\Program Files (x86)\\World of Warcraft'
const PICKS = ['D:\\Games\\WoW\\_classic_era_', 'C:\\Users\\hello\\Documents']
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function createMockApi(): ManagerApi {
  const q = new URLSearchParams(location.search)
  const empty = q.has('empty') && q.get('empty') !== 'packs'
  const offline = q.has('offline')
  const platformParam = q.get('platform')
  const platform = platformParam === 'darwin' || platformParam === 'linux' ? platformParam : 'win32'

  // ?missing=forever,era,anniversary: those games were not found by the scan.
  const missing = (q.get('missing') ?? '').split(',').map((m) => ({ forever: 'forever', era: 'classic_era', anniversary: 'anniversary' })[m.trim()] ?? m.trim())
  let games: GameInstall[] = empty
    ? []
    : [
        game(`${WOW}\\_forever_`, '_forever_', 'forever', 'wow_forever', 'WoW: Forever', '1.60.1.70450'),
        game(`${WOW}\\_classic_era_`, '_classic_era_', 'classic_era', 'wow_classic_era', 'WoW: Classic Era', '1.15.8.65301'),
        { ...game(`${WOW}\\_anniversary_`, '_anniversary_', 'anniversary', 'wow_anniversary', 'WoW: Anniversary', '2.5.5.65340'), writable: !q.has('readonly') }
      ]
  games = games.filter((g) => !missing.includes(g.flavor))
  const forever = games.find((g) => g.flavor === 'forever')
  const era = games.find((g) => g.flavor === 'classic_era')
  const installs: Record<string, Record<string, Installed>> = {}
  if (forever) {
    installs[forever.id] = {
      spoken: { version: '3.4.0', folders: SPOKEN_FOLDERS.filter((f) => f !== 'Spoken_NPCs') },
      'places-audio-deDE': { version: '2.1.0', folders: ['SpokenPlacesAudio_deDE'] },
      'community/elune-quests-deDE': { version: '1.2.0', folders: [communityFolder('elune-quests-deDE')] },
      'community/mirelle-places-frFR': { version: '0.8.0', folders: [communityFolder('mirelle-places-frFR')] }
    }
  }
  if (era) installs[era.id] = { spoken: { version: '3.5.0', folders: SPOKEN_FOLDERS.filter((f) => f !== 'Spoken_NPCs') } }
  const anniversary = games.find((g) => g.flavor === 'anniversary')
  if (anniversary && q.has('linked')) installs[anniversary.id] = { spoken: { version: '3.5.0', folders: [...SPOKEN_FOLDERS], linked: true } }

  const sharingParam = q.get('sharing')
  let settings: Settings = {
    ...DEFAULT_SETTINGS,
    lastGameId: forever?.id ?? '',
    ...(sharingParam === 'on' || sharingParam === 'off' ? { sharing: sharingParam } : {})
  }
  let sharingStatus: SharingStatus = { sending: false, ...(sharingParam === 'on' ? { lastSent: { at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), count: 37 } } : {}) }
  const sharingListeners = new Set<(s: SharingStatus) => void>()
  // ?generate=paired shows a paired Manager with keys, mid-batch.
  let generateStatus: GenerateStatus =
    q.get('generate') === 'paired'
      ? {
          pairedAs: 'Hello',
          keys: { elevenlabs: false, fish: true },
          modes: { elevenlabs: 'site', fish: 'local' },
          current: [{ lineId: 'q:5:accept', npcName: 'Marshal Dughan', preview: 'Ah, a new recruit…' }],
          done: 41,
          failed: 1
        }
      : { pairedAs: null, keys: { elevenlabs: false, fish: false }, modes: { elevenlabs: 'site', fish: 'site' }, current: [], done: 0, failed: 0 }
  const generateListeners = new Set<(s: GenerateStatus) => void>()
  const emitGenerate = (next: GenerateStatus): void => {
    generateStatus = next
    generateListeners.forEach((l) => l(next))
  }
  const releases = buildReleases()
  const packs = q.get('empty') === 'packs' ? [] : COMMUNITY_PACKS
  const everyProduct = (): Product[] => [...PRODUCTS, ...packs.map(communityProduct)]
  const productFor = (id: string): Product | undefined => productById(id) ?? everyProduct().find((p) => p.id === id)
  let fetchedAt = offline ? '2026-10-17T09:12:00Z' : new Date().toISOString()
  const catalog = (): Catalog => ({ fetchedAt, offline, error: offline ? 'getaddrinfo ENOTFOUND api.github.com' : undefined, releases })
  const community = (): CommunityCatalog => ({
    fetchedAt: offline ? '2026-10-17T09:12:00Z' : fetchedAt,
    offline,
    error: offline ? 'getaddrinfo ENOTFOUND raw.githubusercontent.com' : undefined,
    packs
  })

  const jobListeners = new Set<(p: JobProgress) => void>()
  const gameListeners = new Set<(g: GameInstall[]) => void>()
  const communityListeners = new Set<(c: CommunityCatalog) => void>()
  const updaterListeners = new Set<(s: UpdaterState) => void>()
  const maximizedListeners = new Set<(m: boolean) => void>()
  let maximized = false
  const running = new Map<string, { timer: number; cancel: () => void }>()
  let seq = 0
  let cleared = false
  let pick = 0
  const failedOnce = new Set<string>()

  const emit = (p: JobProgress): void => jobListeners.forEach((l) => l({ ...p }))

  function releasesFor(productId: string): ReleaseInfo[] {
    const pk = packs.find((x) => `community/${x.id}` === productId)
    if (pk) return [communityRelease(pk)]
    return (releases[productId] ?? []).filter((r) => settings.includePrereleases || !r.prerelease)
  }

  function statusFor(g: GameInstall, p: Product): ProductStatus {
    const latest = releasesFor(p.id)[0]
    const inst = installs[g.id]?.[p.id]
    if (!inst) return { gameId: g.id, productId: p.id, state: 'not-installed', installedFolders: [], latest }
    if (inst.linked) {
      return {
        gameId: g.id,
        productId: p.id,
        state: 'linked',
        installedVersion: inst.version,
        installedFolders: inst.folders,
        latest,
        blockedReason: 'These folders are links to a development checkout. The manager does not touch them.'
      }
    }
    const c = latest ? compareVersions(inst.version, latest.version) : null
    const state = c === null ? 'unknown' : c < 0 ? 'update-available' : c === 0 ? 'up-to-date' : 'ahead'
    return { gameId: g.id, productId: p.id, state, installedVersion: inst.version, installedFolders: inst.folders, latest }
  }

  const find = (gameId: string): GameInstall => {
    const g = games.find((x) => x.id === gameId)
    if (!g) throw new Error('That game is not in the list any more.')
    return g
  }

  function run(g: GameInstall, p: Product, action: 'install' | 'uninstall', rel: ReleaseInfo | undefined): string {
    const jobId = `job-${++seq}`
    const base: JobProgress = {
      jobId,
      gameId: g.id,
      productId: p.id,
      action,
      phase: 'queued',
      received: 0,
      total: rel?.assetSize ?? 0,
      bytesPerSecond: 0,
      version: rel?.version
    }
    emit(base)
    const start = Date.now()
    const DOWNLOAD = action === 'install' ? 4200 : 0
    const failAt = action === 'install' && p.id === 'readables-audio-deDE' && !failedOnce.has(p.id) ? 0.45 : 2
    let cancelled = false
    const finish = (): void => {
      window.clearInterval(handle.timer)
      running.delete(jobId)
    }
    const handle = {
      timer: 0,
      cancel: () => {
        cancelled = true
        finish()
        emit({ ...base, phase: 'cancelled' })
      }
    }
    running.set(jobId, handle)
    handle.timer = window.setInterval(() => {
      if (cancelled) return
      const t = Date.now() - start
      if (t < 300) return
      const dl = t - 300
      if (dl < DOWNLOAD) {
        const f = dl / DOWNLOAD
        if (f >= failAt) {
          failedOnce.add(p.id)
          finish()
          emit({ ...base, phase: 'error', received: Math.round(base.total * f), message: `Could not download ${rel?.assetName ?? p.id}: the connection was reset. Try again.` })
          return
        }
        emit({ ...base, phase: 'downloading', received: Math.round(base.total * f), bytesPerSecond: 9e6 + Math.sin(dl / 400) * 3e6 })
        return
      }
      const rest = dl - DOWNLOAD
      if (action === 'install') {
        if (rest < 500) return void emit({ ...base, phase: 'verifying', received: base.total })
        if (rest < 1300) return void emit({ ...base, phase: 'extracting', received: base.total })
      }
      const settle = action === 'install' ? 1300 : 0
      if (rest < settle + 600) return void emit({ ...base, phase: 'installing', received: base.total })
      finish()
      if (action === 'install' && rel) {
        const folders = p.folders ?? (p.id === 'quests-audio' ? ['SpokenQuestsAudioAlliance', 'SpokenQuestsAudioHorde', 'SpokenQuestsAudioShared', 'SpokenQuestsAudioGossip'] : [...SPOKEN_FOLDERS])
        installs[g.id] = { ...installs[g.id], [p.id]: { version: rel.version, folders } }
      } else {
        const { [p.id]: _gone, ...rest2 } = installs[g.id] ?? {}
        installs[g.id] = rest2
      }
      emit({
        ...base,
        phase: 'done',
        received: base.total,
        message:
          action === 'uninstall'
            ? `${p.title} was removed from ${g.label}.`
            : p.id === 'spoken'
              ? 'Reload the game (/reload) or restart it to use it.'
              : 'Installed. Reload the game (/reload) to hear it.'
      })
    }, 120)
    return jobId
  }

  const api: ManagerApi = {
    async snapshot(): Promise<Snapshot> {
      await sleep(250)
      return { games, settings, sharingStatus, generateStatus, catalog: catalog(), community: community(), products: PRODUCTS, appVersion: '0.1.0', platform, dataPath: platform === 'darwin' ? '/Users/hello/Library/Application Support/Spoken Manager' : platform === 'linux' ? '/home/hello/.config/Spoken Manager' : 'C:\\Users\\hello\\AppData\\Roaming\\Spoken Manager' }
    },
    async scanGames() {
      await sleep(900)
      return games
    },
    async addGame(path): Promise<AddGameResult> {
      await sleep(400)
      if (!/_(classic_era|anniversary|forever)_|AddOns|World of Warcraft|WoW/i.test(path)) {
        return { error: `${path} does not look like a game Spoken runs on. Pick the game folder, a ${FLAVOR_FOLDER_LIST} folder, or an AddOns folder.` }
      }
      const added = { ...game(path, '_classic_era_', 'classic_era', 'wow_classic_era', 'WoW: Classic Era', '1.15.8.65301'), source: 'manual' as const }
      if (!games.some((g) => g.id === added.id)) games = [...games, added]
      gameListeners.forEach((l) => l(games))
      return { game: added }
    },
    async removeGame(gameId) {
      games = games.filter((g) => g.id !== gameId)
      return games
    },
    async refreshCatalog() {
      await sleep(1100)
      if (!offline) fetchedAt = new Date().toISOString()
      return catalog()
    },
    async refreshCommunity() {
      await sleep(700)
      return community()
    },
    async statuses(gameId) {
      await sleep(60)
      const g = find(gameId)
      return everyProduct().map((p) => statusFor(g, p))
    },
    async install(gameId, productId, options?: InstallOptions) {
      const g = find(gameId)
      if (!g.writable) throw new Error('This folder is read-only for your account.')
      const p = productFor(productId)
      if (!p) throw new Error(`Unknown product ${productId}`)
      if (installs[g.id]?.[p.id]?.linked) throw new Error(`${p.title} on ${g.label} is a link to a development folder, so it was left alone.`)
      const kept = installs[g.id]?.[p.id]?.version
      const wanted = options?.repair ? kept : options?.version
      const rel = wanted ? releases[p.id]?.find((r) => r.version === wanted) ?? releasesFor(p.id)[0] : releasesFor(p.id)[0]
      if (!rel) throw new Error(`There is no release of ${p.title} to install yet.`)
      return run(g, p, 'install', rel)
    },
    async uninstall(gameId, productId) {
      const g = find(gameId)
      const p = productFor(productId)
      if (!p) throw new Error(`Unknown product ${productId}`)
      if (installs[g.id]?.[p.id]?.linked) throw new Error(`${p.title} on ${g.label} is a link to a development folder, so it was left alone.`)
      return run(g, p, 'uninstall', undefined)
    },
    async cancel(jobId) {
      running.get(jobId)?.cancel()
    },
    async setSettings(patch) {
      if (patch.downloadsPath && /[<>"|?*]/.test(patch.downloadsPath)) throw new Error('That folder name has characters Windows does not allow. Pick another folder.')
      settings = { ...settings, ...patch }
      return settings
    },
    async pickFolder() {
      await sleep(250)
      return PICKS[pick++ % PICKS.length] ?? null
    },
    async openPath(path) {
      console.info('[mock] openPath', path)
    },
    async openExternal(url) {
      console.info('[mock] openExternal', url)
    },
    async openLogs() {
      console.info('[mock] openLogs')
    },
    async checkManagerUpdate() {
      const emit = (s: UpdaterState): void => updaterListeners.forEach((l) => l(s))
      emit({ state: 'checking' })
      await sleep(900)
      emit(offline ? { state: 'error', message: "Can't reach GitHub to look for a new manager." } : q.has('update') ? { state: 'available', version: '0.2.0', ...(q.get('update') === 'url' ? { url: 'https://github.com/rusty-key/spoken-wow/releases/latest' } : {}) } : { state: 'idle' })
    },
    async clearDownloads() {
      await sleep(300)
      const out = cleared ? { files: 0, bytes: 0 } : { files: 3, bytes: 2.1 * 1024 * MB }
      cleared = true
      return out
    },
    async shareNow() {
      if (settings.sharing !== 'on') throw new Error('Turn on Sharing first.')
      const emit = (next: SharingStatus): void => {
        sharingStatus = next
        sharingListeners.forEach((l) => l(next))
      }
      emit({ ...sharingStatus, sending: true })
      await sleep(900)
      if (offline) emit({ ...sharingStatus, sending: false, error: 'The site could not be reached (fetch failed).' })
      else emit({ sending: false, lastSent: { at: new Date().toISOString(), count: 12 } })
    },
    async resetShareId() {
      console.info('[mock] resetShareId')
    },
    async generatePair() {
      emitGenerate({ ...generateStatus, pairing: { code: 'K7QM-2XPA', verifyUrl: 'https://spoken.rusty.one/profile?pair=K7QM-2XPA', expiresAt: new Date(Date.now() + 600_000).toISOString() } })
      await sleep(3000)
      const { pairing: _p, ...rest } = generateStatus
      emitGenerate({ ...rest, pairedAs: 'Hello' })
    },
    async generateUnpair() {
      emitGenerate({ ...generateStatus, pairedAs: null })
    },
    async generateSetKey(provider, key) {
      emitGenerate({ ...generateStatus, keys: { ...generateStatus.keys, [provider]: key.trim() !== '' } })
    },
    async windowMinimize() {
      console.info('[mock] windowMinimize')
    },
    async windowToggleMaximize() {
      maximized = !maximized
      maximizedListeners.forEach((l) => l(maximized))
    },
    async windowClose() {
      console.info('[mock] windowClose')
    },
    async windowIsMaximized() {
      return maximized
    },
    onJob(l) {
      jobListeners.add(l)
      return () => void jobListeners.delete(l)
    },
    onGamesChanged(l) {
      gameListeners.add(l)
      return () => void gameListeners.delete(l)
    },
    onCatalogChanged() {
      return () => undefined
    },
    onCommunityChanged(l) {
      communityListeners.add(l)
      return () => void communityListeners.delete(l)
    },
    onSharing(l) {
      sharingListeners.add(l)
      return () => void sharingListeners.delete(l)
    },
    onGenerate(l) {
      generateListeners.add(l)
      return () => void generateListeners.delete(l)
    },
    onWindowMaximized(l) {
      maximizedListeners.add(l)
      return () => void maximizedListeners.delete(l)
    },
    onUpdater(l) {
      updaterListeners.add(l)
      if (q.get('update') === 'url') {
        window.setTimeout(() => l({ state: 'available', version: '0.2.0', url: 'https://github.com/rusty-key/spoken-wow/releases/latest' }), 1500)
      } else if (q.has('update')) {
        window.setTimeout(() => l({ state: 'ready', version: '0.2.0' }), 1500)
      }
      return () => void updaterListeners.delete(l)
    }
  }
  return api
}

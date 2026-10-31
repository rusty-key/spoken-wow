// Finds World of Warcraft installs: the registry, Battle.net's product list, the usual folders,
// and folders the player added by hand. One GameInstall per flavor folder, and only for the game
// versions Spoken runs on (SUPPORTED_FLAVORS): Retail, Classic and the PTRs and betas never appear.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FLAVOR_FOLDER_LIST, SUPPORTED_FLAVORS, type Flavor, type GameInstall } from '../shared/types'
import { canWriteQuick, foldsCase, samePath } from './guard'
import { loadState, log, updateState } from './state'

// ---------------------------------------------------------------- tables

/** `_forever_` -> `forever`; null for anything that is not a game version Spoken runs on. */
export function flavorOfFolder(name: string): Flavor | null {
  const lower = name.toLowerCase()
  return SUPPORTED_FLAVORS.find((f) => `_${f}_` === lower) ?? null
}

/** Any Blizzard flavor folder, supported or not: `_retail_`, `_classic_ptr_`, ... */
function isFlavorFolderName(name: string): boolean {
  return /^_[a-z0-9_]+_$/i.test(name)
}

const LABELS: Record<Flavor, string> = {
  forever: 'WoW: Forever',
  classic_era: 'WoW: Classic Era',
  anniversary: 'WoW: Anniversary'
}

export function labelFor(flavor: Flavor): string {
  return LABELS[flavor]
}

/** Where the ended WoW: Forever beta was installed; the released game is in `_forever_` beside it. */
const FOREVER_BETA_FOLDER = '_classic_beta_'

/** What to tell a player who picked a game Spoken does not run on. */
export function notSupportedMessage(folder: string): string {
  // A player who knew _classic_beta_ as Forever would otherwise read this as a contradiction.
  if (folder.toLowerCase() === FOREVER_BETA_FOLDER) {
    return `${folder} is the WoW: Forever beta, which has ended. Spoken runs on the released game in _forever_.`
  }
  return `Spoken runs on WoW: Forever, Classic Era and Anniversary. ${folder} is not one of them.`
}

/** First 12 hex digits of sha1 of the root, lower-cased where the file system ignores case (Windows, macOS). */
export function gameIdFor(root: string, platform: NodeJS.Platform = process.platform): string {
  return createHash('sha1')
    .update(foldsCase(platform) ? root.toLowerCase() : root)
    .digest('hex')
    .slice(0, 12)
}

// ---------------------------------------------------------------- Blizzard's files

/** `.build.info`: pipe-separated, header names look like `Branch!STRING:0`. One object per row. */
export function parseBuildInfo(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
  const head = lines[0]
  if (!head) return []
  const names = head.split('|').map((h) => h.split('!')[0]!.trim())
  const rows: Record<string, string>[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split('|')
    const row: Record<string, string> = {}
    names.forEach((n, i) => {
      row[n] = (cells[i] ?? '').trim()
    })
    rows.push(row)
  }
  return rows
}

/** `.flavor.info`: a header line, then the product code (`wow_forever`). */
export function parseFlavorInfo(text: string): string | undefined {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  const value = lines.length >= 2 ? lines[1] : lines[0] && !lines[0].includes('!') ? lines[0] : undefined
  return value && /^[A-Za-z0-9_]+$/.test(value) ? value : undefined
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** The real-cased names inside a folder, or null. */
async function names(p: string): Promise<string[] | null> {
  try {
    return await fs.promises.readdir(p)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- one flavor folder

/** The entry of `entries` named `name` ignoring case (the exact name first), else `name` itself: what to create when it is missing. */
function realName(entries: readonly string[] | null, name: string): string {
  if (!entries) return name
  return entries.includes(name) ? name : (entries.find((n) => n.toLowerCase() === name.toLowerCase()) ?? name)
}

/**
 * A GameInstall for a flavor folder, or null when it is not one of the supported ones or holds no
 * Interface or WTF folder, no Wow*.exe and no World of Warcraft*.app (macOS). The AddOns path keeps
 * the casing found on disk (Linux file systems tell `interface` from `Interface`) and uses
 * `Interface/AddOns` when the folders do not exist yet.
 */
export async function describeFlavorFolder(
  flavorPath: string,
  source: 'auto' | 'manual',
  platform: NodeJS.Platform = process.platform
): Promise<GameInstall | null> {
  const root = path.resolve(flavorPath)
  const entries = await names(root)
  if (!entries) return null
  const holdsGame = entries.some((n) => /^(interface|wtf)$/i.test(n) || /^wow.*\.exe$/i.test(n) || /^world of warcraft.*\.app$/i.test(n))
  if (!holdsGame) return null

  const flavorFolder = path.basename(root)
  const flavor = flavorOfFolder(flavorFolder)
  if (!flavor) return null

  const fromFlavorFile = parseFlavorInfo((await readText(path.join(root, '.flavor.info'))) ?? '')
  const product = fromFlavorFile ?? `wow_${flavor}`

  let gameVersion: string | undefined
  const buildText =
    (await readText(path.join(path.dirname(root), '.build.info'))) ?? (await readText(path.join(root, '.build.info')))
  if (buildText) {
    const row = parseBuildInfo(buildText).find((r) => r.Product?.toLowerCase() === product.toLowerCase())
    if (row?.Version) gameVersion = row.Version
  }

  const interfaceName = realName(entries, 'Interface')
  const addOnsName = realName(await names(path.join(root, interfaceName)), 'AddOns')
  const addOnsPath = path.join(root, interfaceName, addOnsName)
  return {
    id: gameIdFor(root, platform),
    root,
    addOnsPath,
    flavorFolder,
    flavor,
    product,
    label: labelFor(flavor),
    ...(gameVersion ? { gameVersion } : {}),
    source,
    writable: await canWriteQuick(addOnsPath)
  }
}

function notWowMessage(platform: NodeJS.Platform): string {
  const addOns = platform === 'win32' ? 'Interface\\AddOns' : 'Interface/AddOns'
  return `This does not look like a World of Warcraft folder. Choose the game folder (the one that holds ${FLAVOR_FOLDER_LIST}), one of those folders, or its ${addOns} folder.`
}

/**
 * Turns a folder the player (or the registry) named into flavor folders: a game folder gives
 * every supported flavor it holds, a flavor folder or an AddOns folder gives that one. A flavor
 * folder of a game Spoken does not run on is refused in plain words.
 */
export async function resolveGamePath(
  input: string,
  source: 'auto' | 'manual',
  platform: NodeJS.Platform = process.platform
): Promise<{ games: GameInstall[]; error?: string }> {
  const NOT_WOW_MESSAGE = notWowMessage(platform)
  const cleaned = typeof input === 'string' ? input.trim().replace(/^"(.*)"$/, '$1') : ''
  if (cleaned === '') return { games: [], error: 'Choose a folder first.' }
  const abs = path.resolve(cleaned)
  if (!(await isDir(abs))) return { games: [], error: 'That folder does not exist.' }

  const base = path.basename(abs)
  const parent = path.dirname(abs)
  let flavorFolder: string | null = null
  let candidates: string[] = []

  if (base.toLowerCase() === 'addons' && path.basename(parent).toLowerCase() === 'interface') {
    flavorFolder = path.dirname(parent)
  } else if (base.toLowerCase() === 'interface') {
    flavorFolder = parent
  } else if (isFlavorFolderName(base)) {
    flavorFolder = abs
  }

  if (flavorFolder) {
    const name = path.basename(flavorFolder)
    if (!flavorOfFolder(name)) return { games: [], error: isFlavorFolderName(name) ? notSupportedMessage(name) : NOT_WOW_MESSAGE }
    candidates = [flavorFolder]
  } else {
    const entries = (await names(abs)) ?? []
    for (const f of SUPPORTED_FLAVORS) {
      const real = entries.find((n) => n.toLowerCase() === `_${f}_`)
      if (real) candidates.push(path.join(abs, real))
    }
    if (candidates.length === 0) {
      const other = entries.find((n) => n.toLowerCase() === FOREVER_BETA_FOLDER) ?? entries.find((n) => isFlavorFolderName(n))
      return { games: [], error: other ? notSupportedMessage(other) : NOT_WOW_MESSAGE }
    }
  }

  const games: GameInstall[] = []
  for (const c of candidates) {
    const g = await describeFlavorFolder(c, source, platform)
    if (g && !games.some((x) => x.id === g.id)) games.push(g)
  }
  return games.length > 0 ? { games } : { games: [], error: NOT_WOW_MESSAGE }
}

// ---------------------------------------------------------------- where to look

function run(file: string, args: string[], timeout = 6000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : String(stdout))
    })
  })
}

/** Paths from `reg query ... /v InstallPath` output. */
export function parseRegQuery(output: string): string[] {
  const out: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*InstallPath\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i.exec(line)
    if (m) out.push(m[1]!)
  }
  return out
}

/** Install paths in Battle.net's `product.db` (protobuf, but the paths are plain text): Windows drive paths, and macOS paths under /Applications, /Volumes or /Users. */
export function parseProductDb(data: Buffer): string[] {
  const text = data.toString('latin1')
  const found = new Set<string>()
  for (const re of [/[A-Za-z]:[\\/][\x20-\x7e]{0,240}?World of Warcraft/g, /\/(?:Applications|Volumes|Users)\/[\x20-\x7e]{0,240}?World of Warcraft/g]) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) found.add(m[0])
  }
  return [...found]
}

async function registryPaths(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft',
    'HKLM\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft'
  ]
  const out: string[] = []
  for (const key of keys) {
    const text = await run('reg', ['query', key, '/s', '/v', 'InstallPath'])
    if (text) out.push(...parseRegQuery(text))
  }
  return out
}

async function battleNetPaths(platform: NodeJS.Platform = process.platform, fsRoot = '/'): Promise<string[]> {
  const file =
    platform === 'win32'
      ? process.env.ProgramData
        ? path.join(process.env.ProgramData, 'Battle.net', 'Agent', 'product.db')
        : ''
      : platform === 'darwin'
        ? path.join(fsRoot, 'Users', 'Shared', 'Battle.net', 'Agent', 'product.db')
        : ''
  if (!file) return []
  try {
    const st = await fs.promises.stat(file)
    if (st.size > 8 * 1024 * 1024) return []
    return parseProductDb(await fs.promises.readFile(file))
  } catch {
    return []
  }
}

async function fixedDrives(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const text = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "[IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' } | ForEach-Object { $_.Name }"
  ])
  const drives = (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[A-Za-z]:\\?$/.test(l))
  if (drives.length > 0) return drives.map((d) => (d.endsWith('\\') ? d : `${d}\\`))
  // PowerShell failed: probe the letters.
  const probed: string[] = []
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const d = `${String.fromCharCode(c)}:\\`
    if (fs.existsSync(d)) probed.push(d)
  }
  return probed
}

export interface DiscoveryOptions {
  /** Default: the running platform. Tests pass another one to run its logic on any machine. */
  platform?: NodeJS.Platform
  /** Default: the player's home folder. */
  homedir?: string
  /** What `/` means: tests point it at a temp folder. Default `/`. */
  fsRoot?: string
  /** The WINEPREFIX variable. Default: the process's. */
  winePrefix?: string | undefined
  /** Longest time the folder search may take, in milliseconds. Default 4000. */
  budgetMs?: number
}

/** The sub-folder names the Linux search does not look into: Lutris keeps Wine builds there, not game prefixes. */
const SKIP_PREFIX_PARENTS = new Set(['runners', 'runtime'])

/**
 * Where a Mac or Linux install may be: the usual Applications folders and mounted volumes on macOS;
 * the Wine prefixes of Wine, Lutris, Bottles, Steam (Proton) and Heroic on Linux. Only folders that
 * exist are returned. The work is a few `readdir` calls without recursion, cut short by the
 * time budget, and every error is ignored. Windows is handled by `findCandidatePaths`.
 */
export async function discoverUnixPaths(options: DiscoveryOptions = {}): Promise<string[]> {
  const platform = options.platform ?? process.platform
  const home = options.homedir ?? os.homedir()
  const root = options.fsRoot ?? '/'
  const deadline = Date.now() + (options.budgetMs ?? 4000)
  const inTime = (): boolean => Date.now() < deadline
  const out: string[] = []

  const listing = async (dir: string): Promise<string[]> => {
    if (!inTime()) return []
    return (await names(dir)) ?? []
  }
  const addIfDir = async (p: string): Promise<void> => {
    if (inTime() && (await isDir(p))) out.push(p)
  }

  if (platform === 'darwin') {
    await addIfDir(path.join(root, 'Applications', 'World of Warcraft'))
    await addIfDir(path.join(home, 'Applications', 'World of Warcraft'))
    for (const v of await listing(path.join(root, 'Volumes'))) {
      await addIfDir(path.join(root, 'Volumes', v, 'World of Warcraft'))
      await addIfDir(path.join(root, 'Volumes', v, 'Applications', 'World of Warcraft'))
    }
  } else if (platform !== 'win32') {
    // Prefix folders: a Wine prefix is a folder holding drive_c.
    const prefixes: string[] = []
    const winePrefix = options.winePrefix !== undefined ? options.winePrefix : process.env.WINEPREFIX
    if (winePrefix) prefixes.push(winePrefix)
    prefixes.push(path.join(home, '.wine'), path.join(home, 'Games', 'battlenet'))
    /** Every sub-folder of `parent` is a prefix; with `inner` each one's `inner` folder is too (Proton keeps its prefix in `pfx`). */
    const children = async (parent: string, inner?: string): Promise<void> => {
      for (const n of await listing(parent)) {
        if (SKIP_PREFIX_PARENTS.has(n)) continue
        prefixes.push(path.join(parent, n))
        if (inner) prefixes.push(path.join(parent, n, inner))
      }
    }
    const share = path.join(home, '.local', 'share')
    const flatpak = path.join(home, '.var', 'app')
    await children(path.join(home, 'Games'))
    await children(path.join(share, 'bottles', 'bottles'))
    await children(path.join(flatpak, 'com.usebottles.bottles', 'data', 'bottles', 'bottles'))
    await children(path.join(share, 'lutris'))
    await children(path.join(share, 'lutris', 'prefixes'))
    await children(path.join(flatpak, 'net.lutris.Lutris', 'data', 'lutris'))
    await children(path.join(flatpak, 'net.lutris.Lutris', 'data', 'lutris', 'prefixes'))
    await children(path.join(home, 'Games', 'Heroic', 'Prefixes'), 'pfx')
    await children(path.join(home, 'Games', 'Heroic', 'Prefixes', 'default'), 'pfx')
    for (const steam of [
      path.join(share, 'Steam'),
      path.join(home, '.steam', 'steam'),
      path.join(flatpak, 'com.valvesoftware.Steam', 'data', 'Steam')
    ]) {
      await children(path.join(steam, 'steamapps', 'compatdata'), 'pfx')
    }
    await addIfDir(path.join(home, 'Games', 'World of Warcraft'))
    for (const p of new Set(prefixes)) {
      for (const programs of ['Program Files (x86)', 'Program Files']) {
        await addIfDir(path.join(p, 'drive_c', programs, 'World of Warcraft'))
      }
    }
  }
  return out
}

/** The same folder reached twice (`/Volumes/Macintosh HD` is `/`) counts once: the first spelling stays. */
async function dropSameFolders(list: string[], platform: NodeJS.Platform): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of list) {
    let real = path.resolve(p)
    try {
      real = await fs.promises.realpath(p)
    } catch {
      // not there: keep the plain spelling
    }
    const key = foldsCase(platform) ? real.toLowerCase() : real
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

/** Every folder worth looking in: Windows registry, Battle.net's list, default roots, each fixed drive; the macOS and Linux places on those systems. */
export async function findCandidatePaths(options: DiscoveryOptions = {}): Promise<string[]> {
  const platform = options.platform ?? process.platform
  const out: string[] = []
  if (platform === 'win32') {
    out.push(...(await registryPaths()))
    out.push(...(await battleNetPaths(platform)))
    out.push('C:\\Program Files (x86)\\World of Warcraft', 'C:\\Program Files\\World of Warcraft')
    for (const d of await fixedDrives()) {
      out.push(
        path.join(d, 'World of Warcraft'),
        path.join(d, 'Games', 'World of Warcraft'),
        path.join(d, 'Program Files (x86)', 'World of Warcraft')
      )
    }
  } else {
    out.push(...(await battleNetPaths(platform, options.fsRoot)))
    out.push(...(await discoverUnixPaths({ ...options, platform })))
  }
  const seen = new Set<string>()
  const unique = out.filter((p) => {
    const abs = path.resolve(p)
    const k = foldsCase(platform) ? abs.toLowerCase() : abs
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return platform === 'win32' ? unique : dropSameFolders(unique, platform)
}

// ---------------------------------------------------------------- the list

export interface ScanOptions {
  /** Used instead of the registry and default-folder search (tests). */
  autoPaths?: string[]
  /** Default: the running platform. */
  platform?: NodeJS.Platform
  /** Where the default-folder search looks, for tests; ignored when autoPaths is given. */
  discovery?: DiscoveryOptions
}

/** Auto-found installs (minus the ones the player removed), then the manual ones. */
export async function scanGames(dataPath: string, options: ScanOptions = {}): Promise<GameInstall[]> {
  let state = loadState(dataPath)
  const platform = options.platform ?? process.platform
  // A game saved by an earlier run that Spoken does not run on is forgotten (nothing on disk is
  // touched). A saved Forever beta gives way to the `_forever_` folder beside it, if there is one.
  const keep: string[] = []
  for (const p of state.manualGames) {
    const name = path.basename(p)
    const beta = name.toLowerCase() === FOREVER_BETA_FOLDER
    const released = beta ? ((await names(path.dirname(p))) ?? []).find((n) => n.toLowerCase() === '_forever_') : undefined
    const kept = beta ? released && path.join(path.dirname(p), released) : flavorOfFolder(name) === null && isFlavorFolderName(name) ? undefined : p
    if (kept && !keep.some((k) => samePath(k, kept, platform))) keep.push(kept)
  }
  if (keep.length !== state.manualGames.length || keep.some((p, i) => p !== state.manualGames[i])) {
    log(`Saved game folders went from ${state.manualGames.length} to ${keep.length}: the ones Spoken does not run on are forgotten, a Forever beta moves to _forever_.`)
    state = updateState(dataPath, (st) => {
      st.manualGames = keep
    })
  }
  const hidden = new Set(state.hiddenGames)
  const found = new Map<string, GameInstall>()
  const candidates = options.autoPaths ?? (await findCandidatePaths({ ...options.discovery, platform }))
  for (const p of candidates) {
    const { games } = await resolveGamePath(p, 'auto', platform)
    for (const g of games) if (!hidden.has(g.id) && !found.has(g.id)) found.set(g.id, g)
  }
  for (const p of state.manualGames) {
    const { games } = await resolveGamePath(p, 'manual', platform)
    for (const g of games) if (!found.has(g.id)) found.set(g.id, g)
  }
  const list = [...found.values()]
  log(`Scan found ${list.length} game install${list.length === 1 ? '' : 's'}.`)
  return list
}

/** Adds a game folder, a flavor folder or an AddOns folder; remembers each flavor folder it resolves to. */
export async function addGame(
  dataPath: string,
  input: string,
  platform: NodeJS.Platform = process.platform
): Promise<{ games: GameInstall[]; error?: string }> {
  const res = await resolveGamePath(input, 'manual', platform)
  if (res.error || res.games.length === 0) return res
  updateState(dataPath, (s) => {
    for (const g of res.games) {
      if (!s.manualGames.some((m) => samePath(m, g.root, platform))) s.manualGames.push(g.root)
      s.hiddenGames = s.hiddenGames.filter((id) => id !== g.id)
    }
  })
  return res
}

/** Takes an install off the list: a manual one is forgotten, an auto-found one is hidden. */
export function removeGame(dataPath: string, game: GameInstall, platform: NodeJS.Platform = process.platform): void {
  updateState(dataPath, (s) => {
    s.manualGames = s.manualGames.filter((m) => !samePath(m, game.root, platform))
    if (game.source === 'auto' && !s.hiddenGames.includes(game.id)) s.hiddenGames.push(game.id)
  })
}

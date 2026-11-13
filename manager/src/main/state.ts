// What the manager keeps on disk under its data folder: settings.json, state.json, the log.
// Every function takes the data path, so nothing here needs electron.
import fs from 'node:fs'
import path from 'node:path'
import { currentProductId } from '../shared/products'
import { DEFAULT_SETTINGS, SETTING_CHOICES, type Settings } from '../shared/types'

// ---------------------------------------------------------------- files

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Writes to a temp file next to the target, then renames it over, so a crash never leaves half a file. */
export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* nothing to clean */
    }
    throw err
  }
}

// ---------------------------------------------------------------- settings

function settingsFile(dataPath: string): string {
  return path.join(dataPath, 'settings.json')
}

/** Keeps only known keys with the right type; everything else falls back to the default. */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base }
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = r[key]
    if (v === undefined) continue
    const want = typeof DEFAULT_SETTINGS[key]
    if (typeof v !== want) continue
    if (typeof v === 'string' && v.length > 2000) continue
    if (SETTING_CHOICES[key] && !SETTING_CHOICES[key].includes(v)) continue
    ;(out as unknown as Record<string, unknown>)[key] = v
  }
  return out
}

export function loadSettings(dataPath: string): Settings {
  return sanitizeSettings(readJsonFile<unknown>(settingsFile(dataPath), {}))
}

export function saveSettings(dataPath: string, settings: Settings): void {
  writeJsonAtomic(settingsFile(dataPath), settings)
}

// ---------------------------------------------------------------- state

/** What the manager put on one game for one product. */
export interface InstallRecord {
  version: string
  folders: string[]
  installedAt: string
  tag: string
  /** Installed as a version the player picked over the newest; automatic updates leave it. */
  pinned?: boolean
}

export interface StateFile {
  version: 1
  /** Flavor folders the player added by hand. */
  manualGames: string[]
  /** Flavor folders the scan finds but the player removed from the list (lower-cased ids). */
  hiddenGames: string[]
  /** gameId -> productId -> record. */
  installs: Record<string, Record<string, InstallRecord>>
}

export function stateFile(dataPath: string): string {
  return path.join(dataPath, 'state.json')
}

function emptyState(): StateFile {
  return { version: 1, manualGames: [], hiddenGames: [], installs: {} }
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function sanitizeState(raw: unknown): StateFile {
  const out = emptyState()
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>
  out.manualGames = strings(r.manualGames)
  out.hiddenGames = strings(r.hiddenGames)
  const installs = r.installs
  if (typeof installs === 'object' && installs !== null) {
    for (const [gameId, products] of Object.entries(installs as Record<string, unknown>)) {
      if (typeof products !== 'object' || products === null) continue
      const perGame: Record<string, InstallRecord> = {}
      for (const [savedId, rec] of Object.entries(products as Record<string, unknown>)) {
        if (typeof rec !== 'object' || rec === null) continue
        const x = rec as Record<string, unknown>
        if (typeof x.version !== 'string') continue
        // Saved under the pack's id before its section was renamed; a record under the new id wins.
        const productId = currentProductId(savedId)
        if (productId !== savedId && perGame[productId]) continue
        perGame[productId] = {
          version: x.version,
          folders: strings(x.folders),
          installedAt: typeof x.installedAt === 'string' ? x.installedAt : '',
          tag: typeof x.tag === 'string' ? x.tag : '',
          pinned: x.pinned === true || undefined
        }
      }
      out.installs[gameId] = perGame
    }
  }
  return out
}

export function loadState(dataPath: string): StateFile {
  return sanitizeState(readJsonFile<unknown>(stateFile(dataPath), {}))
}

export function saveState(dataPath: string, state: StateFile): void {
  writeJsonAtomic(stateFile(dataPath), state)
}

export function getRecord(state: StateFile, gameId: string, productId: string): InstallRecord | undefined {
  return state.installs[gameId]?.[productId]
}

/**
 * Records an install. A folder belongs to one product at a time, so a folder that another product
 * of the same game listed (the English "all" quests bundle and one of its split packs share
 * folders) moves to this one.
 */
export function setRecord(state: StateFile, gameId: string, productId: string, record: InstallRecord): void {
  const perGame = (state.installs[gameId] ??= {})
  for (const [otherId, other] of Object.entries(perGame)) {
    if (otherId === productId) continue
    other.folders = other.folders.filter((f) => !record.folders.includes(f))
    if (other.folders.length === 0) delete perGame[otherId]
  }
  perGame[productId] = record
}

export function removeRecord(state: StateFile, gameId: string, productId: string): void {
  const perGame = state.installs[gameId]
  if (!perGame) return
  delete perGame[productId]
  if (Object.keys(perGame).length === 0) delete state.installs[gameId]
}

/** Read, change, write: synchronous, so two jobs on different games never overwrite each other. */
export function updateState(dataPath: string, change: (state: StateFile) => void): StateFile {
  const state = loadState(dataPath)
  change(state)
  saveState(dataPath, state)
  return state
}

// ---------------------------------------------------------------- log

const LOG_LIMIT = 1024 * 1024
let logFile: string | null = null

export function logsDir(dataPath: string): string {
  return path.join(dataPath, 'logs')
}

/** Starts logging to `<dataPath>/logs/manager.log`; one older file (`manager.log.1`) is kept. */
export function initLog(dataPath: string): void {
  logFile = path.join(logsDir(dataPath), 'manager.log')
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
  } catch {
    logFile = null
  }
}

function describe(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** One plain line with the time. Never throws. */
export function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map(describe).join(' ')}\n`
  if (!logFile) {
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) process.stderr.write(line)
    return
  }
  try {
    try {
      if (fs.statSync(logFile).size > LOG_LIMIT) {
        fs.renameSync(logFile, `${logFile}.1`)
      }
    } catch {
      /* no file yet */
    }
    fs.appendFileSync(logFile, line, 'utf8')
  } catch {
    /* logging must never break the app */
  }
}

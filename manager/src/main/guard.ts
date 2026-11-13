// The checks that run before the installer changes anything: linked folders, allowed names,
// safe zip paths, free space, write access, a running game.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Product } from '../shared/types'
import { SPOKEN_FOLDERS } from '../shared/products'
import { PlainError, formatBytes } from './errors'
import { t } from './i18n'

// ---------------------------------------------------------------- linked folders

/** The path rules of a platform: Windows paths on Windows, POSIX paths elsewhere. On the running platform this is `path`. */
function pathFor(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix
}

/** Windows and macOS file systems ignore letter case by default; Linux does not. */
export function foldsCase(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/** Whether two paths name the same place, comparing case the way the platform's file system does. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const x = pathFor(platform).resolve(a)
  const y = pathFor(platform).resolve(b)
  return foldsCase(platform) ? x.toLowerCase() === y.toLowerCase() : x === y
}

/** The real-cased entry of `dir` named `name` ignoring case (the exact name preferred), or null when there is none. */
export function findEntrySync(dir: string, name: string): string | null {
  try {
    const list = fs.readdirSync(dir)
    return list.includes(name) ? name : (list.find((n) => n.toLowerCase() === name.toLowerCase()) ?? null)
  } catch {
    return null
  }
}

/**
 * True when `p` is a symlink or a Windows junction. A junction is not always reported by lstat,
 * so the real path is compared with where the path says it is (its parent's real path plus its
 * own name). A missing path is not linked.
 */
export async function isLinked(p: string): Promise<boolean> {
  let st: fs.Stats
  try {
    st = await fs.promises.lstat(p)
  } catch {
    return false
  }
  if (st.isSymbolicLink()) return true
  try {
    const real = await fs.promises.realpath(p)
    const parentReal = await fs.promises.realpath(path.dirname(p))
    return !samePath(real, path.join(parentReal, path.basename(p)))
  } catch {
    // Cannot resolve it: do not treat it as a plain folder.
    return true
  }
}

/** A function, not a constant, so it follows a language change. */
export function linkedMessage(): string {
  return t('guard.linked')
}

// ---------------------------------------------------------------- allowed names

/** The folder names a product may install: voice packs' own and their names before a rename, Spoken's list. */
export function allowedFolders(product: Product): string[] {
  return [...(product.folders ?? SPOKEN_FOLDERS), ...(product.legacy?.folders ?? [])]
}

export type EntryCheck = { ok: true; segments: string[]; directory: boolean } | { ok: false; reason: string }

const BAD_CHARS = /[\0<>:"|?*\x01-\x1f]/

/**
 * Checks one zip entry name. Entry names use `/`. Refuses `..`, absolute paths, drive letters,
 * backslashes, NUL and other characters Windows reads specially, and any first segment that is
 * not an allowed folder name (exact case). A trailing `/` marks a directory entry.
 */
export function checkEntryPath(name: string, allowed: readonly string[]): EntryCheck {
  if (typeof name !== 'string' || name.length === 0) return { ok: false, reason: 'empty name' }
  if (name.includes('\\')) return { ok: false, reason: 'backslash' }
  if (name.includes('\0')) return { ok: false, reason: 'NUL' }
  if (name.startsWith('/')) return { ok: false, reason: 'absolute path' }
  if (/^[A-Za-z]:/.test(name)) return { ok: false, reason: 'drive letter' }
  const directory = name.endsWith('/')
  const segments = (directory ? name.slice(0, -1) : name).split('/')
  for (const s of segments) {
    if (s === '') return { ok: false, reason: 'empty segment' }
    if (s === '.' || s === '..') return { ok: false, reason: 'relative segment' }
    if (BAD_CHARS.test(s)) return { ok: false, reason: 'special character' }
    if (/[. ]$/.test(s)) return { ok: false, reason: 'trailing dot or space' }
  }
  if (!allowed.includes(segments[0]!)) return { ok: false, reason: 'folder not allowed' }
  if (!directory && segments.length < 2) return { ok: false, reason: 'file outside a folder' }
  return { ok: true, segments, directory }
}

/** True when `child` is `parent` or inside it (no `..` escape). */
export function isInside(parent: string, child: string, platform: NodeJS.Platform = process.platform): boolean {
  const p = pathFor(platform)
  const fold = (x: string): string => (foldsCase(platform) ? x.toLowerCase() : x)
  const rel = p.relative(fold(p.resolve(parent)), fold(p.resolve(child)))
  if (rel === '') return true
  return !rel.startsWith('..') && !p.isAbsolute(rel)
}

// ---------------------------------------------------------------- disk

async function nearestExisting(p: string): Promise<string> {
  let cur = path.resolve(p)
  for (;;) {
    try {
      await fs.promises.access(cur)
      return cur
    } catch {
      const up = path.dirname(cur)
      if (up === cur) return cur
      cur = up
    }
  }
}

async function freeSpace(dir: string): Promise<number> {
  const at = await nearestExisting(dir)
  const s = await fs.promises.statfs(at)
  return Number(s.bavail) * Number(s.bsize)
}

/** The volume a path lives on, so two folders on one drive can be checked together. */
export async function volumeOf(dir: string): Promise<string> {
  const at = await nearestExisting(dir)
  const st = await fs.promises.stat(at)
  return String(st.dev)
}

/** Throws in plain words when `dir`'s drive has less than `needed` bytes free. */
export async function ensureFreeSpace(dir: string, needed: number, what = 'this'): Promise<void> {
  let free: number
  try {
    free = await freeSpace(dir)
  } catch {
    return // cannot tell: let the write fail if it must
  }
  if (free < needed) {
    const drive = path.parse(path.resolve(dir)).root.replace(/[\\/]+$/, '') || dir
    throw new PlainError(t('guard.noSpace', { drive, what, needed: formatBytes(needed), free: formatBytes(free) }))
  }
}

/** Cheap write check for scans: the nearest existing parent is a folder and not marked read-only. Creates nothing. */
export async function canWriteQuick(dir: string): Promise<boolean> {
  const at = await nearestExisting(dir)
  try {
    if (!(await fs.promises.stat(at)).isDirectory()) return false
    await fs.promises.access(at, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Whether a file can really be created in `dir` (or its nearest existing parent). */
export async function canWrite(dir: string): Promise<boolean> {
  const at = await nearestExisting(dir)
  try {
    if (!(await fs.promises.stat(at)).isDirectory()) return false
  } catch {
    return false
  }
  const probe = path.join(at, `.spoken-manager-write-test-${process.pid}-${Date.now()}`)
  try {
    await fs.promises.writeFile(probe, '')
    await fs.promises.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * The reason a downloads folder cannot be used, in plain words, or null when it can. It must be a
 * full local path that exists or can be created, and not inside a game's AddOns or WTF folder.
 */
export function checkDownloadsPath(
  value: string,
  games: readonly { root: string; addOnsPath: string }[],
  platform: NodeJS.Platform = process.platform
): string | null {
  if (value === '') return null
  if (value.includes('\0') || value.length > (platform === 'win32' ? 240 : 1024)) return t('guard.dlBadName')
  if (platform === 'win32' && /^[\\/]{2}/.test(value)) {
    return t('guard.dlNetwork')
  }
  if (!pathFor(platform).isAbsolute(value)) {
    return platform === 'win32' ? t('guard.dlFullWin') : t('guard.dlFullUnix')
  }
  const abs = pathFor(platform).resolve(value)
  for (const g of games) {
    const wtf = pathFor(platform).join(g.root, findEntrySync(g.root, 'WTF') ?? 'WTF')
    if (isInside(g.addOnsPath, abs, platform) || isInside(wtf, abs, platform)) {
      return t('guard.dlInGame')
    }
  }
  let at = abs
  for (;;) {
    try {
      const st = fs.statSync(at)
      if (!st.isDirectory()) return at === abs ? t('guard.dlIsFile') : t('guard.dlFileInWay')
      fs.accessSync(at, fs.constants.W_OK)
      return null
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOTDIR') return t('guard.dlFileInWay')
      if (code !== 'ENOENT') return t('guard.dlNoWrite')
      const up = path.dirname(at)
      if (up === at) return t('guard.dlNoDrive')
      at = up
    }
  }
}

// ---------------------------------------------------------------- running game

/** Process names from `tasklist /FO CSV /NH` output. */
export function parseTasklist(output: string): string[] {
  const names: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line.trim())
    if (m) names.push(m[1]!)
  }
  return names
}

/** `Wow.exe`, `WowClassic.exe`, `WowB.exe`, `WowClassicT.exe`, ...: starts with Wow, ends .exe. */
export function isWowProcess(name: string): boolean {
  return /^wow.*\.exe$/i.test(name)
}

/**
 * Whether a line of `ps -A -o comm=,args=` output is a World of Warcraft client: the macOS app
 * bundle's executable, or a Windows client (`Wow.exe`, `WowClassic.exe`, `WowB.exe`, ...) under Wine.
 */
export function isWowPsLine(line: string): boolean {
  if (/\/Contents\/MacOS\/(?:World of Warcraft|Wow)/i.test(line)) return true
  if (/^World of Warcraft(?:\s|$)/i.test(line.trim())) return true
  return /(?:^|[\\/\s])wow[^\s\\/"]*\.exe(?=\s|$|")/i.test(line)
}

/** True when any line of `ps -A -o comm=,args=` output is a WoW client. */
export function parsePs(output: string): boolean {
  return output.split(/\r?\n/).some((l) => l.trim() !== '' && isWowPsLine(l))
}

function capture(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: 8000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout)))
    } catch {
      resolve(null)
    }
  })
}

export interface RunningOptions {
  platform?: NodeJS.Platform
  /** Runs a command and gives its output, or null when it is missing or fails (tests). */
  exec?: (file: string, args: string[]) => Promise<string | null>
}

/**
 * Whether any World of Warcraft client is running: `tasklist` on Windows, `ps` on macOS and Linux.
 * The flavor is accepted for the caller's sake; the process names differ too much to tell which
 * client it is. When the command is missing or fails the answer is false, so it never blocks an install.
 */
export async function isGameRunning(_flavor?: string, options: RunningOptions = {}): Promise<boolean> {
  const platform = options.platform ?? process.platform
  const exec = options.exec ?? capture
  try {
    if (platform === 'win32') {
      const out = await exec('tasklist', ['/FO', 'CSV', '/NH'])
      return out !== null && parseTasklist(out).some(isWowProcess)
    }
    const out = await exec('ps', ['-A', '-o', 'comm=,args='])
    return out !== null && parsePs(out)
  } catch {
    return false
  }
}

// Sharing: sends the lines Spoken collected to the site, when the player said yes.
//
// Spoken keeps every line it had no voice for in WTF/Account/<account>/SavedVariables/
// SpokenContributions.lua (addons/Spoken/Gather.lua). The site's /contribute page takes that file
// by hand; this reads it in the player's place and sends the envelopes in it to the same route.
// It never writes there: WTF is the game's, and the game writes the file from memory at every
// logout, so anything changed in it would come back anyway. What was sent is remembered here
// instead, as hashes in share.json, with the random install id the site counts players by. To
// empty the file, the lines sent are listed in Interface/AddOns/SpokenContributions/Sent.lua, which
// the game only reads, and Spoken drops them at the next login (Gather:DropSent).
//
// No electron imports, so it can be tested the way state.ts is.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { envelopesFromSavedVariables } from '@site-contributions/saved-variables'
import { chunksOf } from '@site-contributions/upload'
import type { GameInstall, SendResult } from '../shared/types'
import { findEntrySync, isLinked } from './guard'
import type { LocalFile } from './packs-plan'
import { t } from './i18n'
import { sha256Text } from './packs-remote'
import { log, readJsonFile, writeJsonAtomic } from './state'

export const SHARE_URL = 'https://spoken.quest/api/contributions/batch'

/** Hashes kept; the oldest go first. Far more than one file holds (MAX_ENVELOPES). */
export const LEDGER_CAP = 20000

/** The site may take five minutes for a full file (nginx's proxy_read_timeout on the route). */
const POST_TIMEOUT_MS = 310 * 1000

export interface ShareLedger {
  /** A random v4 UUID, made when sharing is first turned on. */
  installId: string
  /** sha256 of each envelope the site took, to when; in the order they were sent. */
  sent: Record<string, string>
  lastSent?: { at: string; count: number }
  /** Each file's size and time as last read, so a poll reads only what the game has rewritten. */
  seen: Record<string, SeenFile>
}

export interface SeenFile extends LocalFile {
  /** The sentMark of each envelope in the file that was sent, so Sent.lua is built without reading it again. */
  marks?: string[]
}

function ledgerFile(dataPath: string): string {
  return path.join(dataPath, 'share.json')
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function records<T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  return Object.fromEntries(Object.entries(v).filter(([, x]) => ok(x))) as Record<string, T>
}

export function loadLedger(dataPath: string): ShareLedger {
  const raw = readJsonFile<Record<string, unknown>>(ledgerFile(dataPath), {})
  const id = typeof raw.installId === 'string' && UUID_V4.test(raw.installId) ? raw.installId : ''
  const last = raw.lastSent as { at?: unknown; count?: unknown } | undefined
  return {
    installId: id,
    sent: records(raw.sent, (x): x is string => typeof x === 'string'),
    ...(last && typeof last.at === 'string' && typeof last.count === 'number' ? { lastSent: { at: last.at, count: last.count } } : {}),
    seen: records(raw.seen, (x): x is SeenFile => {
      const s = x as { size?: unknown; mtimeMs?: unknown; marks?: unknown }
      return (
        typeof x === 'object' &&
        x !== null &&
        typeof s.size === 'number' &&
        typeof s.mtimeMs === 'number' &&
        (s.marks === undefined || (Array.isArray(s.marks) && s.marks.every((m) => typeof m === 'string')))
      )
    })
  }
}

export function saveLedger(dataPath: string, ledger: ShareLedger): void {
  writeJsonAtomic(ledgerFile(dataPath), ledger)
}

export function hashEnvelope(envelope: string): string {
  return sha256Text(envelope).slice(0, 32)
}

/**
 * What Gather:SentMark makes of the envelope in the game: its `sum=` and its length in bytes. The
 * addon has no sha256 to hand, and hashing every line at login would stall it; the sum is already
 * on the envelope's last line. Null for one without a sum, which the addon never drops.
 */
export function sentMark(envelope: string): string | null {
  const sum = /\nsum=(\d+)\n$/.exec(envelope)
  return sum ? `${sum[1]}:${Buffer.byteLength(envelope, 'utf8')}` : null
}

/** The Lua Sent.lua holds: the marks as keys of SpokenContributionsSent, sorted so an unchanged list writes the same bytes. */
export function sentLua(marks: Iterable<string>): string {
  const keys = [...new Set(marks)].sort().map((m) => `["${m}"]=true,`)
  return `-- Written by the Spoken Manager: the lines it sent, which Spoken drops at login.\nSpokenContributionsSent = {\n${keys.join('\n')}${keys.length ? '\n' : ''}}\n`
}

/**
 * Writes the game's Sent.lua when its contents changed. Only into a SpokenContributions folder
 * that is there and not linked: a linked one is a developer's checkout. A failure is logged and
 * left for the next send, since the lines then only stay in the file a while longer.
 */
async function writeSentFile(game: GameInstall, marks: Iterable<string>): Promise<void> {
  const folder = findEntrySync(game.addOnsPath, 'SpokenContributions')
  if (!folder) return
  const dir = path.join(game.addOnsPath, folder)
  const file = path.join(dir, findEntrySync(dir, 'Sent.lua') ?? 'Sent.lua')
  if ((await isLinked(dir)) || (await isLinked(file))) return
  const text = sentLua(marks)
  try {
    if ((await fs.promises.readFile(file, 'utf8').catch(() => null)) === text) return
    const tmp = `${file}.${process.pid}.tmp`
    await fs.promises.writeFile(tmp, text, 'utf8')
    await fs.promises.rename(tmp, file)
  } catch (err) {
    log('Sharing: could not write', file, err)
  }
}

/** Every SpokenContributions.lua of a game, one per account, matched ignoring case. Linked folders and files are skipped. */
export async function findContributionFiles(game: GameInstall): Promise<string[]> {
  const out: string[] = []
  const wtf = findEntrySync(game.root, 'WTF')
  const account = wtf && findEntrySync(path.join(game.root, wtf), 'Account')
  if (!wtf || !account) return out
  const accounts = path.join(game.root, wtf, account)
  if (await isLinked(accounts)) return out
  let names: string[]
  try {
    names = await fs.promises.readdir(accounts)
  } catch {
    return out
  }
  for (const name of names.sort()) {
    const dir = path.join(accounts, name)
    const sv = findEntrySync(dir, 'SavedVariables')
    if (!sv || (await isLinked(dir))) continue
    const file = findEntrySync(path.join(dir, sv), 'SpokenContributions.lua')
    if (!file) continue
    const full = path.join(dir, sv, file)
    if (await isLinked(full)) continue
    out.push(full)
  }
  return out
}

export interface SendOptions {
  dataPath: string
  /** The ledger as the caller holds it, updated in place; read from dataPath when not given. */
  ledger?: ShareLedger
  games: GameInstall[]
  appVersion: string
  fetchImpl?: typeof fetch
  url?: string
  signal?: AbortSignal
  /** Reads every file, not only those the game rewrote since the last read ("Send now"). */
  all?: boolean
}

function remember(ledger: ShareLedger, hashes: Iterable<string>, at: string): void {
  for (const h of hashes) {
    // Deleted first so a hash sent again moves to the newest end.
    delete ledger.sent[h]
    ledger.sent[h] = at
  }
  const keys = Object.keys(ledger.sent)
  for (const k of keys.slice(0, Math.max(0, keys.length - LEDGER_CAP))) delete ledger.sent[k]
}

/**
 * Reads the games' files and sends what the site has not taken yet. `sent` is written after each
 * request the site took, so a failure part way keeps what went through; the files' sizes and
 * times only once every request went through, so after a failure they read as changed and the
 * next attempt reads them again. Throws only when aborted.
 */
export async function sendPending(opts: SendOptions): Promise<SendResult> {
  const ledger = opts.ledger ?? loadLedger(opts.dataPath)
  if (!ledger.installId) {
    // Kept at once: the site counts players by it, so it must not change between attempts.
    ledger.installId = crypto.randomUUID()
    saveLedger(opts.dataPath, ledger)
  }
  /** The envelopes not sent yet, by hash. */
  const fresh = new Map<string, string>()
  const seen: ShareLedger['seen'] = {}
  const unread: string[] = []
  /** Each file read this time: the hash and sentMark of every envelope in it. */
  const read = new Map<string, Map<string, string | null>>()
  const filesOf = new Map<GameInstall, string[]>()
  for (const game of opts.games) {
    const files = await findContributionFiles(game)
    filesOf.set(game, files)
    for (const file of files) {
      let st: fs.Stats
      try {
        st = await fs.promises.stat(file)
      } catch {
        continue
      }
      const before = ledger.seen[file]
      if (!opts.all && before && before.size === st.size && before.mtimeMs === st.mtimeMs) {
        seen[file] = before
        continue
      }
      seen[file] = { size: st.size, mtimeMs: st.mtimeMs }
      let text: string
      try {
        text = await fs.promises.readFile(file, 'utf8')
      } catch (err) {
        log('Sharing: could not read', file, err)
        unread.push(file)
        delete seen[file]
        continue
      }
      const inFile = new Map<string, string | null>()
      for (const e of envelopesFromSavedVariables(text)) {
        const h = hashEnvelope(e)
        inFile.set(h, sentMark(e))
        if (!ledger.sent[h]) fresh.set(h, e)
      }
      read.set(file, inFile)
    }
  }
  // Replaced whole: a file that went away is forgotten, so it is read again if it comes back.
  // Written only when it changed: a poll that found nothing new leaves share.json alone.
  const done = async (result: SendResult): Promise<SendResult> => {
    const before = ledger.seen
    for (const [file, inFile] of read) {
      const marks = [...inFile].flatMap(([h, mark]) => (mark && ledger.sent[h] ? [mark] : []))
      seen[file] = { ...seen[file]!, ...(marks.length ? { marks } : {}) }
    }
    if (JSON.stringify(seen) !== JSON.stringify(ledger.seen)) {
      ledger.seen = seen
      saveLedger(opts.dataPath, ledger)
    }
    // A file that could not be read keeps its marks from before: its lines were sent all the same.
    for (const [game, files] of filesOf) await writeSentFile(game, files.flatMap((f) => (seen[f] ?? before[f])?.marks ?? []))
    return result
  }
  const unreadPart = unread.length ? { unread } : {}
  if (fresh.size === 0) return done({ outcome: 'nothing', ...unreadPart })

  const doFetch = opts.fetchImpl ?? fetch
  const hashes = [...fresh.keys()]
  let count = 0
  for (const chunk of chunksOf([...fresh.values()])) {
    opts.signal?.throwIfAborted()
    let res: Response
    try {
      const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(POST_TIMEOUT_MS)]) : AbortSignal.timeout(POST_TIMEOUT_MS)
      res = await doFetch(opts.url ?? SHARE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': `SpokenManager/${opts.appVersion}` },
        body: JSON.stringify({ envelopes: chunk, installId: ledger.installId }),
        signal
      })
    } catch (err) {
      opts.signal?.throwIfAborted()
      return { outcome: 'failed', count, error: t('share.reachSite', { why: err instanceof Error ? err.message : String(err) }) }
    }
    if (res.status === 429) return { outcome: 'rate-limited', count }
    if (!res.ok) return { outcome: 'failed', count, error: t('share.siteStatus', { status: res.status }) }
    const at = new Date().toISOString()
    // Chunks keep the envelopes' order, so the chunk's hashes are the next ones in line.
    remember(ledger, hashes.slice(count, count + chunk.length), at)
    count += chunk.length
    ledger.lastSent = { at, count }
    saveLedger(opts.dataPath, ledger)
  }
  return done({ outcome: 'sent', count, ...unreadPart })
}

/** A new install id; what was sent stays sent. */
export function resetInstallId(dataPath: string, ledger: ShareLedger = loadLedger(dataPath)): void {
  ledger.installId = crypto.randomUUID()
  saveLedger(dataPath, ledger)
}

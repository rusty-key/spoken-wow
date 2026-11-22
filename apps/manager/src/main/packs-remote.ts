// The manager channel's signed index and manifests. A file is used only when its ed25519
// signature checks out against the key built into the manager, and a manifest only when it is the
// one the index names. Spec: docs/superpowers/specs/2026-10-18-manager-delta-packs-design.md
import { createHash, createPublicKey, verify } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PRODUCTS } from '../shared/products'
import { LANG_CODE, QUESTS_SIDES, SECTIONS, TEAM_SLUG, type ChannelTeam, type QuestsSide, type Section } from '../shared/types'
import { PlainError } from './errors'
import { PACKS_BASE_URL, PACKS_PUBLIC_KEY } from './packs-key'
import { log } from './state'
import { t } from './i18n'

export interface ChannelFile {
  /** Relative to the pack folder, `/`-separated. */
  path: string
  sha256: string
  size: number
}
export interface ChannelRequires {
  /** `>=3.0.0`. */
  Spoken: string
}
export interface ChannelManifest {
  packId: string
  rev: string
  requires: ChannelRequires
  fileCount: number
  totalSize: number
  files: ChannelFile[]
}
export interface ChannelPack {
  rev: string
  manifestSha256: string
  fileCount: number
  totalSize: number
  requires: ChannelRequires
}
export interface ChannelAddon {
  version: string
  sha256: string
  size: number
}
export interface ChannelIndex {
  generatedAt: string
  packs: Record<string, ChannelPack>
  /** The channel's copies of an addon's release zips, by product id. */
  addons?: Record<string, ChannelAddon[]>
}
/** An index-v2.json entry: what index.json says of a pack, and whose it is. */
export interface ChannelPackV2 extends ChannelPack {
  lang: string
  section: Section
  /** The quests side; null for every other section. */
  pack: QuestsSide | null
  /** Null for a page pack: today's packs, which name no team. */
  team: ChannelTeam | null
}
export interface ChannelIndexV2 {
  generatedAt: string
  packs: Record<string, ChannelPackV2>
  addons?: Record<string, ChannelAddon[]>
  /** The names of every language the index lists, so a language the Manager does not know can be shown. */
  languages: Record<string, { name: string; native: string }>
}
export interface ChannelOptions {
  baseUrl?: string
  publicKey?: string
  fetchImpl?: typeof fetch
  userAgent?: string
  signal?: AbortSignal
}

const SHA = /^[0-9a-f]{64}$/
const REV = /^\d{8}T\d{6}Z$/
// A pack's folder: Spoken and its name, then a language code but for English's, then the slug of a team whose packs
// in the language are not the plain ones.
const PACK_ID = /^Spoken[A-Za-z]+(_[a-z]{2}[A-Z]{2}(_[a-z][a-z0-9-]{1,40})?)?$/
const NAME_MAX = 200
const REQUIRES = /^>=\d+\.\d+\.\d+$/
const ADDON_VERSION = /^\d+\.\d+\.\d+$/
const BAD_CHARS = /[\0<>:"|?*\\\x01-\x1f]/

function refuse(why: string): never {
  throw new PlainError(t('packs.notTrusted', { why }))
}

// Windows treats these as devices whatever the extension: CON, CON.txt and con.ogg are all the console.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function isSafePackPath(p: unknown): p is string {
  if (typeof p !== 'string' || p === '' || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !BAD_CHARS.test(s) && !/[. ]$/.test(s) && !RESERVED.test(s.split('.')[0]!))
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The `signed` text of an envelope whose signature checks out; throws otherwise. */
export function openEnvelope(raw: string, publicKey: string = PACKS_PUBLIC_KEY): string {
  let env: { signed?: unknown; sig?: unknown }
  try {
    env = JSON.parse(raw) as typeof env
  } catch {
    return refuse('not JSON')
  }
  if (typeof env?.signed !== 'string' || typeof env?.sig !== 'string') return refuse('no signature')
  const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
  if (!verify(null, Buffer.from(env.signed, 'utf8'), key, Buffer.from(env.sig, 'base64'))) return refuse('bad signature')
  return env.signed
}

function isRequires(r: unknown): r is ChannelRequires {
  return typeof r === 'object' && r !== null && typeof (r as ChannelRequires).Spoken === 'string' && REQUIRES.test((r as ChannelRequires).Spoken)
}
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0

// Dropped rather than refused, unlike a bad pack entry: GitHub still has the file, and refusing would hide every voice pack.
function parseAddons(raw: unknown): Record<string, ChannelAddon[]> {
  const out: Record<string, ChannelAddon[]> = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [id, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue
    out[id] = (list as Partial<ChannelAddon>[])
      .filter((c): c is ChannelAddon => !!c && typeof c.version === 'string' && ADDON_VERSION.test(c.version) && typeof c.sha256 === 'string' && SHA.test(c.sha256) && isCount(c.size) && c.size > 0)
      .map((c) => ({ version: c.version, sha256: c.sha256, size: c.size }))
  }
  return out
}

/** The entry as index.json has it; null when any field fails its check. */
function packEntry(id: string, entry: unknown): ChannelPack | null {
  const x = (entry ?? {}) as Partial<ChannelPack>
  if (
    !PACK_ID.test(id) ||
    typeof x.rev !== 'string' ||
    !REV.test(x.rev) ||
    typeof x.manifestSha256 !== 'string' ||
    !SHA.test(x.manifestSha256) ||
    !isCount(x.fileCount) ||
    !isCount(x.totalSize) ||
    !isRequires(x.requires)
  ) {
    return null
  }
  return { rev: x.rev, manifestSha256: x.manifestSha256, fileCount: x.fileCount, totalSize: x.totalSize, requires: { Spoken: x.requires.Spoken } }
}

interface RawIndex {
  generatedAt: string
  packs: Record<string, unknown>
  addons?: unknown
  languages?: unknown
}

function indexShape(signed: string): RawIndex {
  const raw = JSON.parse(signed) as Partial<Record<keyof RawIndex, unknown>>
  if (typeof raw.generatedAt !== 'string' || typeof raw.packs !== 'object' || raw.packs === null) return refuse('index shape')
  return raw as RawIndex
}

export function parseIndex(signed: string): ChannelIndex {
  const raw = indexShape(signed)
  const packs: Record<string, ChannelPack> = {}
  for (const [id, entry] of Object.entries(raw.packs)) {
    const pack = packEntry(id, entry)
    if (!pack) return refuse(`index entry ${id}`)
    packs[id] = pack
  }
  return { generatedAt: raw.generatedAt, packs, addons: parseAddons(raw.addons) }
}

const isName = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= NAME_MAX

/** Null for a page pack; undefined when the team fails its check. */
function parseTeam(v: unknown): ChannelTeam | null | undefined {
  if (v === null) return null
  const t = v as Partial<ChannelTeam> | undefined
  if (!t || typeof t.slug !== 'string' || !TEAM_SLUG.test(t.slug) || !isName(t.name) || typeof t.official !== 'boolean') return undefined
  return { slug: t.slug, name: t.name, official: t.official }
}

/**
 * index-v2.json. Unlike index.json, an entry that fails a check is dropped and logged rather than refusing the whole
 * index: one team's broken entry must not hide every other pack. The signature still covers the whole file.
 */
export function parseIndexV2(signed: string, report: (line: string) => void = (line) => log(line)): ChannelIndexV2 {
  const raw = indexShape(signed)
  const packs: Record<string, ChannelPackV2> = {}
  for (const [id, entry] of Object.entries(raw.packs)) {
    const base = packEntry(id, entry)
    const x = (entry ?? {}) as Partial<Record<keyof ChannelPackV2, unknown>>
    const team = parseTeam(x.team)
    const section = typeof x.section === 'string' && (SECTIONS as readonly string[]).includes(x.section) ? (x.section as Section) : undefined
    const side = x.pack === null ? null : typeof x.pack === 'string' && (QUESTS_SIDES as readonly string[]).includes(x.pack) ? (x.pack as QuestsSide) : undefined
    // A quests pack is one side of the quests; no other section has sides.
    if (!base || typeof x.lang !== 'string' || !LANG_CODE.test(x.lang) || section === undefined || side === undefined || (section === 'quests') !== (side !== null) || team === undefined) {
      report(`Voice pack index: left out ${JSON.stringify(id).slice(0, 80)}, whose entry fails its checks.`)
      continue
    }
    packs[id] = { ...base, lang: x.lang, section, pack: side, team }
  }
  const languages: ChannelIndexV2['languages'] = {}
  if (typeof raw.languages === 'object' && raw.languages !== null) {
    for (const [code, l] of Object.entries(raw.languages as Record<string, unknown>)) {
      const named = (l ?? {}) as { name?: unknown; native?: unknown }
      if (LANG_CODE.test(code) && isName(named.name) && isName(named.native)) languages[code] = { name: named.name, native: named.native }
    }
  }
  return { generatedAt: raw.generatedAt, packs, addons: parseAddons(raw.addons), languages }
}

/** What each folder of the products' table is: index.json says no more than the id. */
const PLACES: ReadonlyMap<string, { lang: string; section: Section; pack: QuestsSide | null }> = new Map(
  PRODUCTS.filter((p) => p.kind === 'voices' && p.pack !== 'all').map((p) => [p.folders![0]!, { lang: p.lang!, section: p.section!, pack: p.section === 'quests' ? (p.pack as QuestsSide) : null }])
)

/** index.json as v2: its ids placed through the products' folders, as page packs. An id the table lacks is dropped. */
export function fromV1(index: ChannelIndex): ChannelIndexV2 {
  const packs: Record<string, ChannelPackV2> = {}
  for (const [id, pack] of Object.entries(index.packs)) {
    const place = PLACES.get(id)
    if (place) packs[id] = { ...pack, ...place, team: null }
  }
  return { generatedAt: index.generatedAt, packs, ...(index.addons ? { addons: index.addons } : {}), languages: {} }
}

export function parseManifest(signed: string, packId: string, pack: ChannelPack): ChannelManifest {
  if (sha256Text(signed) !== pack.manifestSha256) return refuse(`${packId} manifest is not the one the index names`)
  const raw = JSON.parse(signed) as Partial<ChannelManifest>
  if (raw.packId !== packId || raw.rev !== pack.rev || !Array.isArray(raw.files) || !isRequires(raw.requires)) return refuse(`${packId} manifest shape`)
  const seen = new Set<string>()
  const files: ChannelFile[] = []
  for (const f of raw.files as Partial<ChannelFile>[]) {
    if (!f || !isSafePackPath(f.path) || typeof f.sha256 !== 'string' || !SHA.test(f.sha256) || !isCount(f.size)) return refuse(`${packId} file entry`)
    // Windows and macOS fold case, so two paths that differ only in case would be one file.
    const folded = f.path.toLowerCase()
    if (seen.has(folded)) return refuse(`${packId} lists ${f.path} twice`)
    seen.add(folded)
    files.push({ path: f.path, sha256: f.sha256, size: f.size })
  }
  // A pack with no .toc at its root is not an addon, and syncing to it would empty the folder.
  if (!seen.has(`${packId}.toc`.toLowerCase())) return refuse(`${packId} manifest has no ${packId}.toc`)
  return { packId, rev: pack.rev, requires: { Spoken: raw.requires.Spoken }, fileCount: files.length, totalSize: files.reduce((n, f) => n + f.size, 0), files }
}

// net.fetch has no time limit of its own, and a silent server would hold the job forever.
const GET_TIMEOUT_MS = 60_000

/** The body; with `missing`, null on a 404. */
async function getText(url: string, opts: ChannelOptions): Promise<string>
async function getText(url: string, opts: ChannelOptions, missing: 'may-be-missing'): Promise<string | null>
async function getText(url: string, opts: ChannelOptions, missing?: 'may-be-missing'): Promise<string | null> {
  const timeout = AbortSignal.timeout(GET_TIMEOUT_MS)
  const res = await (opts.fetchImpl ?? fetch)(url, {
    headers: opts.userAgent ? { 'User-Agent': opts.userAgent } : {},
    signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  })
  if (missing && res.status === 404) return null
  if (!res.ok) throw new PlainError(t('packs.serverStatus', { status: res.status }))
  return res.text()
}

// Each index has its own file: with one, an index.json read as the way back would overwrite a newer index-v2.json.
function indexFile(dataPath: string): string {
  return path.join(dataPath, 'channel-index.json')
}

function indexV2File(dataPath: string): string {
  return path.join(dataPath, 'channel-index-v2.json')
}

function manifestFile(dataPath: string, packId: string, rev: string): string {
  return path.join(dataPath, 'manifests', `${packId}-${rev}.json`)
}

function readCached<T>(file: string, parse: (signed: string) => T, publicKey?: string): T | null {
  try {
    return parse(openEnvelope(fs.readFileSync(file, 'utf8'), publicKey))
  } catch {
    return null
  }
}

const cachedV1 = (dataPath: string, publicKey?: string): ChannelIndex | null => readCached(indexFile(dataPath), parseIndex, publicKey)
// Its dropped entries were logged when it was fetched.
const cachedV2 = (dataPath: string, publicKey?: string): ChannelIndexV2 | null => readCached(indexV2File(dataPath), (s) => parseIndexV2(s, () => undefined), publicKey)

/** The newer of the two; v2 when they are as old, since it lists more. */
function newer(v2: ChannelIndexV2 | null, v1: ChannelIndexV2 | null): ChannelIndexV2 | null {
  if (!v2 || !v1) return v2 ?? v1
  return Date.parse(v1.generatedAt) > Date.parse(v2.generatedAt) ? v1 : v2
}

/** The index saved by the last good fetch, verified again; null when there is none or it fails. */
export function loadCachedIndex(dataPath: string, publicKey?: string): ChannelIndexV2 | null {
  const v1 = cachedV1(dataPath, publicKey)
  return newer(cachedV2(dataPath, publicKey), v1 && fromV1(v1))
}

/**
 * The fetched index, saved, unless the one in use is newer: a cache edge or a replay can serve an older signed index,
 * and taking it would offer a downgrade to blobs gc may have removed. The one in use when the fetched one says no more,
 * so what is built from it is not built again: one as old that is the same, or, for index.json, one as old at all,
 * since the one in use may be the v2 of that publish, which lists more.
 */
function settle(file: string, raw: string, index: ChannelIndexV2, current: ChannelIndexV2 | null, tie: 'same' | 'any'): ChannelIndexV2 {
  if (current) {
    const age = Date.parse(index.generatedAt) - Date.parse(current.generatedAt)
    if (age < 0) {
      log(`Voice pack index from ${index.generatedAt} is older than the one in use from ${current.generatedAt}; kept that one.`)
      return current
    }
    if (age === 0 && (tie === 'any' || JSON.stringify(index) === JSON.stringify(current))) return current
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, raw, 'utf8')
  return index
}

/**
 * index-v2.json from the server, saved for offline use, or index.json read as v2 when the channel has no v2. A v2 that
 * fails its signature is refused, not read around: that is an attack or a broken channel, not an old one. `current` is
 * the index in use, which a fetch must not go back from and which stands when the server cannot be reached or fails
 * the checks; without it, the saved one is read. It is asked for once the answer is in, not when the request goes out,
 * since another fetch may have brought a newer one meanwhile.
 */
export async function fetchIndex(
  dataPath: string,
  opts: ChannelOptions = {},
  current?: () => ChannelIndexV2 | null
): Promise<{ index: ChannelIndexV2 | null; offline: boolean; error?: string }> {
  const base = opts.baseUrl ?? PACKS_BASE_URL
  const known = current ?? (() => loadCachedIndex(dataPath, opts.publicKey))
  try {
    const rawV2 = await getText(`${base}index-v2.json`, opts, 'may-be-missing')
    if (rawV2 !== null) return { index: settle(indexV2File(dataPath), rawV2, parseIndexV2(openEnvelope(rawV2, opts.publicKey)), known(), 'same'), offline: false }
    const raw = await getText(`${base}index.json`, opts)
    return { index: settle(indexFile(dataPath), raw, fromV1(parseIndex(openEnvelope(raw, opts.publicKey))), known(), 'any'), offline: false }
  } catch (err) {
    log('Voice pack index:', err)
    return { index: known(), offline: true, error: err instanceof Error ? err.message : String(err) }
  }
}

// A manifest is immutable per hash, so one that was verified once is not read and checked again.
const verified = new Map<string, ChannelManifest>()
const memoKey = (packId: string, pack: ChannelPack): string => `${packId}@${pack.rev}@${pack.manifestSha256}`

export function loadCachedManifest(dataPath: string, packId: string, pack: ChannelPack, publicKey?: string): ChannelManifest | null {
  const known = verified.get(memoKey(packId, pack))
  if (known) return known
  try {
    const manifest = parseManifest(openEnvelope(fs.readFileSync(manifestFile(dataPath, packId, pack.rev), 'utf8'), publicKey), packId, pack)
    verified.set(memoKey(packId, pack), manifest)
    return manifest
  } catch {
    return null
  }
}

/** A pack's manifest, from disk when this rev was fetched before; older revs of the pack are deleted. */
export async function fetchManifest(dataPath: string, packId: string, pack: ChannelPack, opts: ChannelOptions = {}): Promise<ChannelManifest> {
  const cached = loadCachedManifest(dataPath, packId, pack, opts.publicKey)
  if (cached) return cached
  const raw = await getText(`${opts.baseUrl ?? PACKS_BASE_URL}packs/${packId}/${pack.rev}.json`, opts)
  const manifest = parseManifest(openEnvelope(raw, opts.publicKey), packId, pack)
  const file = manifestFile(dataPath, packId, pack.rev)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (const name of fs.readdirSync(path.dirname(file))) {
    if (name.startsWith(`${packId}-`) && name !== path.basename(file)) fs.rmSync(path.join(path.dirname(file), name), { force: true })
  }
  fs.writeFileSync(file, raw, 'utf8')
  verified.set(memoKey(packId, pack), manifest)
  return manifest
}

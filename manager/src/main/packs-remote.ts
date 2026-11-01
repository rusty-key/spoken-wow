// The manager channel's signed index and manifests. A file is used only when its ed25519
// signature checks out against the key built into the manager, and a manifest only when it is the
// one the index names. Spec: docs/superpowers/specs/2026-10-18-manager-delta-packs-design.md
import { createHash, createPublicKey, verify } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PlainError } from './errors'
import { PACKS_BASE_URL, PACKS_PUBLIC_KEY } from './packs-key'
import { log } from './state'

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
export interface ChannelIndex {
  generatedAt: string
  packs: Record<string, ChannelPack>
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
const PACK_ID = /^Spoken[A-Za-z]+(_[a-z]{2}[A-Z]{2})?$/
const REQUIRES = /^>=\d+\.\d+\.\d+$/
const BAD_CHARS = /[\0<>:"|?*\\\x01-\x1f]/

function refuse(why: string): never {
  throw new PlainError(`The voice pack list could not be trusted (${why}), so it was not used.`)
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

export function parseIndex(signed: string): ChannelIndex {
  const raw = JSON.parse(signed) as { generatedAt?: unknown; packs?: unknown }
  if (typeof raw.generatedAt !== 'string' || typeof raw.packs !== 'object' || raw.packs === null) return refuse('index shape')
  const packs: Record<string, ChannelPack> = {}
  for (const [id, entry] of Object.entries(raw.packs as Record<string, unknown>)) {
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
      return refuse(`index entry ${id}`)
    }
    packs[id] = { rev: x.rev, manifestSha256: x.manifestSha256, fileCount: x.fileCount, totalSize: x.totalSize, requires: { Spoken: x.requires.Spoken } }
  }
  return { generatedAt: raw.generatedAt, packs }
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

async function getText(url: string, opts: ChannelOptions): Promise<string> {
  const timeout = AbortSignal.timeout(GET_TIMEOUT_MS)
  const res = await (opts.fetchImpl ?? fetch)(url, {
    headers: opts.userAgent ? { 'User-Agent': opts.userAgent } : {},
    signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  })
  if (!res.ok) throw new PlainError(`The voice pack server answered ${res.status}. Try again later.`)
  return res.text()
}

function indexFile(dataPath: string): string {
  return path.join(dataPath, 'channel-index.json')
}

function manifestFile(dataPath: string, packId: string, rev: string): string {
  return path.join(dataPath, 'manifests', `${packId}-${rev}.json`)
}

/** The index saved by the last good fetch, verified again; null when there is none or it fails. */
export function loadCachedIndex(dataPath: string, publicKey?: string): ChannelIndex | null {
  try {
    return parseIndex(openEnvelope(fs.readFileSync(indexFile(dataPath), 'utf8'), publicKey))
  } catch {
    return null
  }
}

/** The index from the server, saved for offline use; the saved one when the server cannot be reached or fails the checks. */
export async function fetchIndex(dataPath: string, opts: ChannelOptions = {}): Promise<{ index: ChannelIndex | null; offline: boolean; error?: string }> {
  try {
    const raw = await getText(`${opts.baseUrl ?? PACKS_BASE_URL}index.json`, opts)
    const index = parseIndex(openEnvelope(raw, opts.publicKey))
    // A cache edge or a replay can serve an older signed index; taking it would offer a downgrade to blobs gc may have removed.
    const cached = loadCachedIndex(dataPath, opts.publicKey)
    if (cached && Date.parse(index.generatedAt) < Date.parse(cached.generatedAt)) {
      log(`Voice pack index from ${index.generatedAt} is older than the saved one from ${cached.generatedAt}; kept the saved one.`)
      return { index: cached, offline: false }
    }
    fs.mkdirSync(dataPath, { recursive: true })
    fs.writeFileSync(indexFile(dataPath), raw, 'utf8')
    return { index, offline: false }
  } catch (err) {
    log('Voice pack index:', err)
    return { index: loadCachedIndex(dataPath, opts.publicKey), offline: true, error: err instanceof Error ? err.message : String(err) }
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

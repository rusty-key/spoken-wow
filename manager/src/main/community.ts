// The community voice-pack registry: the approved packs listed by spoken.quest (`GET /api/community/packs`),
// ETag-cached, kept offline. The list is untrusted input: every entry is validated and a bad one is dropped
// (and logged), never repaired. A valid entry becomes a Product and a ReleaseInfo, so the ordinary
// download, install, status and uninstall code handles it.
import path from 'node:path'
import {
  communityFolder,
  type CommunityCatalog,
  type CommunityPack,
  type Product,
  type ReleaseInfo,
  type Section
} from '../shared/types'
import { compareVersions } from '../shared/version'
import { log, readJsonFile, writeJsonAtomic } from './state'

const REGISTRY_URL = 'https://spoken.quest/api/community/packs'
export const COMMUNITY_PREFIX = 'community/'

const MAX_PACKS = 500
const MAX_BYTES = 2 * 1024 * 1024
const MAX_ZIP = 8 * 1024 ** 3
const SECTIONS: Section[] = ['quests', 'places', 'readables']
/** The keys the registry's format had before Places and Readables were renamed, still read. */
const RENAMED_SECTIONS: Record<string, Section> = { zones: 'places', books: 'readables' }
/** A language code as a pack's .toc writes it: two lower-case letters, two upper-case. */
const LANGUAGE_CODE = /^[a-z]{2}[A-Z]{2}$/
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

// ---------------------------------------------------------------- validation

const CONTROL = /[\u0000-\u001f\u007f]/

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 && s.length <= max && !CONTROL.test(s) ? s : null
}

/** `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>` or an objects.githubusercontent.com link. */
export function isAllowedPackUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500) return false
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || (u.port !== '' && u.port !== '443')) return false
  if (u.search !== '' || u.hash !== '') return false
  if (u.hostname === 'objects.githubusercontent.com') return u.pathname.length > 1
  return u.hostname === 'github.com' && /^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/releases\/download\/[^/]+\/[^/]+$/.test(u.pathname)
}

function isHttps(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && u.username === '' && u.password === '' && !CONTROL.test(value)
  } catch {
    return false
  }
}

/** One entry, or the reason it is refused. */
export function validatePack(raw: unknown): { pack: CommunityPack } | { reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { reason: 'not an object' }
  const r = raw as Record<string, unknown>
  const id = r.id
  if (typeof id !== 'string' || id.length > 48 || !ID.test(id)) return { reason: 'bad id' }
  const title = text(r.title, 80)
  if (!title) return { reason: 'bad title' }
  const author = text(r.author, 80)
  if (!author) return { reason: 'bad author' }
  const description = text(r.description, 400)
  if (!description) return { reason: 'bad description' }
  if (typeof r.lang !== 'string' || !LANGUAGE_CODE.test(r.lang)) return { reason: 'unknown language' }
  const section = typeof r.section === 'string' ? (RENAMED_SECTIONS[r.section] ?? r.section) : null
  if (!section || !SECTIONS.includes(section as Section)) return { reason: 'unknown section' }
  const version = r.version
  if (typeof version !== 'string' || version.length > 40 || /\s/.test(version) || compareVersions(version, version) === null) {
    return { reason: 'bad version' }
  }
  const size = r.size
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ZIP) return { reason: 'bad size' }
  if (typeof r.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(r.sha256)) return { reason: 'bad sha256' }
  if (!isAllowedPackUrl(r.url)) return { reason: 'url is not a GitHub release asset' }
  const addedAt = typeof r.addedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.addedAt) ? r.addedAt : null
  if (!addedAt) return { reason: 'bad addedAt' }

  let homepage: string | undefined
  if (r.homepage !== undefined) {
    if (!isHttps(r.homepage)) return { reason: 'homepage is not an https link' }
    homepage = r.homepage
  }
  let license: string | undefined
  if (r.license !== undefined) {
    const l = text(r.license, 60)
    if (!l) return { reason: 'bad license' }
    license = l
  }
  return {
    pack: {
      id,
      title,
      author,
      description,
      lang: r.lang,
      section: section as Section,
      version,
      size,
      sha256: r.sha256.toLowerCase(),
      url: r.url as string,
      ...(homepage ? { homepage } : {}),
      ...(license ? { license } : {}),
      addedAt
    }
  }
}

/** Every valid entry of a parsed registry; the rest are dropped and logged. Throws when the file is not `{packs: [...]}`. */
export function validateRegistry(raw: unknown): CommunityPack[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { packs?: unknown }).packs)) {
    throw new Error('the registry is not {"packs": [...]}')
  }
  const list = (raw as { packs: unknown[] }).packs
  const out: CommunityPack[] = []
  const seen = new Set<string>()
  list.slice(0, MAX_PACKS).forEach((entry, i) => {
    const res = validatePack(entry)
    if ('reason' in res) {
      const id = typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string' ? (entry as { id: string }).id.slice(0, 48) : '?'
      log(`Community entry ${i} (${JSON.stringify(id)}) dropped: ${res.reason}.`)
      return
    }
    if (seen.has(res.pack.id)) {
      log(`Community entry ${i} (${res.pack.id}) dropped: duplicate id.`)
      return
    }
    seen.add(res.pack.id)
    out.push(res.pack)
  })
  if (list.length > MAX_PACKS) log(`Community registry has ${list.length} entries; only the first ${MAX_PACKS} were read.`)
  return out
}

// ---------------------------------------------------------------- products

export function isCommunityProductId(id: string): boolean {
  return id.startsWith(COMMUNITY_PREFIX) && id.length <= COMMUNITY_PREFIX.length + 48 && ID.test(id.slice(COMMUNITY_PREFIX.length))
}

export function communityProduct(pack: Pick<CommunityPack, 'id'> & Partial<CommunityPack>): Product {
  return {
    id: `${COMMUNITY_PREFIX}${pack.id}`,
    kind: 'community',
    title: pack.title ?? pack.id,
    description: pack.description ?? '',
    ...(pack.section ? { section: pack.section } : {}),
    ...(pack.lang ? { lang: pack.lang } : {}),
    tagPrefix: `${COMMUNITY_PREFIX}${pack.id}`,
    folders: [communityFolder(pack.id)],
    assetPattern: '^.+\\.zip$'
  }
}

export function communityRelease(pack: CommunityPack): ReleaseInfo {
  let assetName = 'pack.zip'
  try {
    assetName = decodeURIComponent(new URL(pack.url).pathname.split('/').pop() ?? assetName)
  } catch {
    /* keep the default */
  }
  return {
    productId: `${COMMUNITY_PREFIX}${pack.id}`,
    tag: `${COMMUNITY_PREFIX}${pack.id}/v${pack.version}`,
    version: pack.version,
    prerelease: false,
    publishedAt: pack.addedAt,
    notes: pack.description,
    assetName,
    assetSize: pack.size,
    assetUrl: pack.url,
    digest: `sha256:${pack.sha256}`,
    htmlUrl: pack.homepage ?? ''
  }
}

// ---------------------------------------------------------------- fetch and cache

function emptyCommunity(): CommunityCatalog {
  return { fetchedAt: null, offline: false, packs: [] }
}

interface Cache {
  etag: string
  fetchedAt: string
  body: unknown
}

function cacheFile(dataPath: string): string {
  return path.join(dataPath, 'github-cache', 'community-packs.json')
}

function communityFile(dataPath: string): string {
  return path.join(dataPath, 'community.json')
}

function packsOf(body: unknown): CommunityPack[] {
  try {
    return validateRegistry(body)
  } catch (err) {
    log('Community registry unreadable:', err)
    return []
  }
}

/** The last saved catalog, validated again in case the file was edited. */
export function loadCommunity(dataPath: string): CommunityCatalog {
  const raw = readJsonFile<Partial<CommunityCatalog> | null>(communityFile(dataPath), null)
  if (!raw || typeof raw !== 'object') return emptyCommunity()
  return {
    fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : null,
    offline: raw.offline === true,
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    packs: packsOf({ packs: Array.isArray(raw.packs) ? raw.packs : [] })
  }
}

export function saveCommunity(dataPath: string, catalog: CommunityCatalog): void {
  writeJsonAtomic(communityFile(dataPath), catalog)
}

export interface FetchCommunityOptions {
  dataPath: string
  appVersion: string
  fetchImpl?: typeof fetch
  url?: string
  timeoutMs?: number
}

/** The registry. On any failure the cached packs come back with `offline: true` and the reason. */
export async function fetchCommunity(opts: FetchCommunityOptions): Promise<CommunityCatalog> {
  const cached = readJsonFile<Partial<Cache> | null>(cacheFile(opts.dataPath), null)
  const usable = cached && typeof cached.etag === 'string' ? (cached as Cache) : null
  const offline = (error: string): CommunityCatalog => {
    log(`Community registry failed: ${error}`)
    return { fetchedAt: usable?.fetchedAt ?? null, offline: true, error, packs: usable ? packsOf(usable.body) : [] }
  }

  const headers: Record<string, string> = { 'User-Agent': `SpokenManager/${opts.appVersion}`, Accept: 'application/json' }
  if (usable) headers['If-None-Match'] = usable.etag
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(opts.url ?? REGISTRY_URL, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 30000) })
  } catch (err) {
    return offline(`Could not reach spoken.quest (${err instanceof Error ? err.message : String(err)}).`)
  }

  const now = new Date().toISOString()
  if (res.status === 304 && usable) return { fetchedAt: now, offline: false, packs: packsOf(usable.body) }
  // The route always answers, with an empty list when nothing is published, so a 404 is a
  // broken deploy or proxy: keep the packs we had rather than clear them.
  if (res.status === 429 || res.status === 403) return offline('spoken.quest is limiting how often this computer may ask. Try again in a little while.')
  if (!res.ok) return offline(`spoken.quest answered with an error (${res.status}).`)

  let body: unknown
  try {
    const raw = await res.text()
    if (raw.length > MAX_BYTES) return offline('The community list is too large to read.')
    body = JSON.parse(raw)
  } catch {
    return offline('The community list is not valid JSON.')
  }
  let packs: CommunityPack[]
  try {
    packs = validateRegistry(body)
  } catch (err) {
    return offline(err instanceof Error ? `The community list is not in the expected format (${err.message}).` : 'The community list is not in the expected format.')
  }
  const etag = res.headers.get('etag')
  if (etag) {
    try {
      writeJsonAtomic(cacheFile(opts.dataPath), { etag, fetchedAt: now, body } satisfies Cache)
    } catch (err) {
      log('Could not write the community cache:', err)
    }
  }
  return { fetchedAt: now, offline: false, packs }
}

// The GitHub Releases list of rusty-key/spoken-wow. Public, no token, ETag-cached on disk.
// The only things sent are the request itself and a User-Agent with the manager's version.
import fs from 'node:fs'
import path from 'node:path'
import { log, readJsonFile, writeJsonAtomic } from './state'

export const REPO = 'rusty-key/spoken-wow'
const PER_PAGE = 100
const MAX_PAGES = 5

export interface GithubAsset {
  name: string
  size: number
  browser_download_url: string
  digest?: string | null
  state?: string
}

export interface GithubRelease {
  tag_name: string
  name?: string | null
  draft?: boolean
  prerelease?: boolean
  published_at?: string | null
  created_at?: string | null
  body?: string | null
  html_url?: string
  assets?: GithubAsset[]
}

export interface ReleasesResult {
  releases: GithubRelease[]
  /** The request failed and `releases` is what was cached (possibly nothing). */
  offline: boolean
  /** True when the failure was GitHub's rate limit. */
  rateLimited: boolean
  /** Plain words for the failure. */
  error?: string
  /** When the data was fetched (the newest page's time). */
  fetchedAt: string | null
}

interface PageCache {
  etag: string
  fetchedAt: string
  body: unknown[]
}

export interface FetchReleasesOptions {
  dataPath: string
  appVersion: string
  fetchImpl?: typeof fetch
  /** Base URL, for tests. */
  apiBase?: string
  timeoutMs?: number
}

function pageFile(dataPath: string, page: number): string {
  return path.join(dataPath, 'github-cache', `github-releases-page-${page}.json`)
}

function loadPage(dataPath: string, page: number): PageCache | null {
  const c = readJsonFile<Partial<PageCache> | null>(pageFile(dataPath, page), null)
  if (!c || typeof c.etag !== 'string' || !Array.isArray(c.body)) return null
  return { etag: c.etag, body: c.body, fetchedAt: typeof c.fetchedAt === 'string' ? c.fetchedAt : '' }
}

function cachedReleases(dataPath: string): { releases: GithubRelease[]; fetchedAt: string | null } {
  const releases: GithubRelease[] = []
  let fetchedAt: string | null = null
  for (let page = 1; page <= MAX_PAGES; page++) {
    const c = loadPage(dataPath, page)
    if (!c) break
    releases.push(...(c.body as GithubRelease[]))
    if (page === 1 && c.fetchedAt) fetchedAt = c.fetchedAt
    if (c.body.length < PER_PAGE) break
  }
  return { releases, fetchedAt }
}

function resetTime(headers: Headers): string {
  const reset = Number(headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) {
    const d = new Date(reset * 1000)
    return ` Try again after ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
  }
  const retry = Number(headers.get('retry-after'))
  if (Number.isFinite(retry) && retry > 0) return ` Try again in ${Math.ceil(retry / 60)} minute${retry > 60 ? 's' : ''}.`
  return ' Try again in a little while.'
}

function isRateLimited(res: Response): boolean {
  if (res.status === 429) return true
  if (res.status !== 403) return false
  return res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')
}

class PageFailure extends Error {
  constructor(
    message: string,
    readonly rateLimited: boolean
  ) {
    super(message)
  }
}

async function fetchPage(opts: FetchReleasesOptions, page: number): Promise<unknown[]> {
  const doFetch = opts.fetchImpl ?? fetch
  const cached = loadPage(opts.dataPath, page)
  const headers: Record<string, string> = {
    'User-Agent': `SpokenManager/${opts.appVersion}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (cached) headers['If-None-Match'] = cached.etag
  const url = `${opts.apiBase ?? 'https://api.github.com'}/repos/${REPO}/releases?per_page=${PER_PAGE}&page=${page}`

  let res: Response
  try {
    res = await doFetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 30000) })
  } catch (err) {
    throw new PageFailure(`Could not reach GitHub (${err instanceof Error ? err.message : String(err)}).`, false)
  }

  if (res.status === 304 && cached) return cached.body
  if (isRateLimited(res)) {
    throw new PageFailure(`GitHub is limiting how often this computer may ask for updates.${resetTime(res.headers)}`, true)
  }
  if (!res.ok) throw new PageFailure(`GitHub answered with an error (${res.status}).`, false)

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new PageFailure('GitHub sent an answer the manager could not read.', false)
  }
  if (!Array.isArray(body)) throw new PageFailure('GitHub sent an answer the manager could not read.', false)
  const etag = res.headers.get('etag')
  if (etag) {
    try {
      writeJsonAtomic(pageFile(opts.dataPath, page), { etag, fetchedAt: new Date().toISOString(), body } satisfies PageCache)
    } catch (err) {
      log('Could not write the GitHub cache:', err)
    }
  }
  return body
}

/** The release list. On any failure the cached list comes back with `offline: true` and the reason. */
export async function fetchReleases(opts: FetchReleasesOptions): Promise<ReleasesResult> {
  const all: GithubRelease[] = []
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await fetchPage(opts, page)
      all.push(...(body as GithubRelease[]))
      if (body.length < PER_PAGE) break
    }
    // Drop cache pages beyond the ones now in use, so an old long list cannot come back offline.
    const used = Math.min(MAX_PAGES, Math.max(1, Math.ceil(all.length / PER_PAGE)))
    for (let page = used + 1; page <= MAX_PAGES; page++) fs.rmSync(pageFile(opts.dataPath, page), { force: true })
    log(`GitHub: ${all.length} releases.`)
    return { releases: all, offline: false, rateLimited: false, fetchedAt: new Date().toISOString() }
  } catch (err) {
    const failure = err instanceof PageFailure ? err : new PageFailure(String(err), false)
    const cached = cachedReleases(opts.dataPath)
    log(`GitHub failed: ${failure.message}`)
    return {
      releases: cached.releases,
      offline: true,
      rateLimited: failure.rateLimited,
      error: failure.message,
      fetchedAt: cached.fetchedAt
    }
  }
}

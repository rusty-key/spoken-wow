import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCatalog, latestFor, loadCatalog, saveCatalog } from '../src/main/catalog'
import { fetchReleases, type GithubRelease } from '../src/main/github'
import { tmpDir } from './helpers'

const DIGEST = `sha256:${'ab'.repeat(32)}`

function rel(tag: string, assetName: string | null, extra: Partial<GithubRelease> & { digest?: string; size?: number } = {}): GithubRelease {
  const { digest, size, ...rest } = extra
  return {
    tag_name: tag,
    name: tag,
    draft: false,
    prerelease: false,
    published_at: '2026-10-01T00:00:00Z',
    body: `notes of ${tag}`,
    html_url: `https://github.com/rusty-key/spoken-wow/releases/tag/${tag}`,
    assets: assetName
      ? [
          { name: 'notes.txt', size: 5, browser_download_url: 'https://example/notes.txt' },
          {
            name: assetName,
            size: size ?? 1000,
            browser_download_url: `https://github.com/rusty-key/spoken-wow/releases/download/${tag}/${assetName}`,
            ...(digest ? { digest } : {}),
            state: 'uploaded'
          }
        ]
      : [],
    ...rest
  }
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...(init.headers as object) }, ...init })
}

describe('fetchReleases', () => {
  const opts = (dataPath: string, fetchImpl: typeof fetch) => ({ dataPath, appVersion: '0.1.0', fetchImpl })

  it('sends the documented headers, no token, and asks for 100 per page', async () => {
    const data = tmpDir()
    const seen: { url: string; headers: Record<string, string> }[] = []
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> })
      return json([rel('spoken/v1.0.0', 'Spoken-1.0.0.zip')], { headers: { etag: 'W/"1"' } })
    }) as unknown as typeof fetch
    const res = await fetchReleases(opts(data, f))
    expect(res.offline).toBe(false)
    expect(res.releases).toHaveLength(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('https://api.github.com/repos/rusty-key/spoken-wow/releases?per_page=100&page=1')
    expect(seen[0]!.headers).toMatchObject({
      'User-Agent': 'SpokenManager/0.1.0',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    })
    expect(Object.keys(seen[0]!.headers).map((k) => k.toLowerCase())).not.toContain('authorization')
  })

  it('uses If-None-Match and the cached body on a 304', async () => {
    const data = tmpDir()
    const calls: (string | undefined)[] = []
    const f = (async (_url: string, init: RequestInit) => {
      const inm = (init.headers as Record<string, string>)['If-None-Match']
      calls.push(inm)
      if (inm === 'W/"abc"') return new Response(null, { status: 304 })
      return json([rel('spoken/v1.0.0', 'Spoken-1.0.0.zip')], { headers: { etag: 'W/"abc"' } })
    }) as unknown as typeof fetch
    const first = await fetchReleases(opts(data, f))
    const second = await fetchReleases(opts(data, f))
    expect(calls).toEqual([undefined, 'W/"abc"'])
    expect(second.offline).toBe(false)
    expect(second.releases).toEqual(first.releases)
  })

  it('follows pages until one has fewer than 100 releases', async () => {
    const data = tmpDir()
    const page = (n: number, count: number): GithubRelease[] =>
      Array.from({ length: count }, (_, i) => rel(`spoken/v1.${n}.${i}`, `Spoken-1.${n}.${i}.zip`))
    const urls: string[] = []
    const f = (async (url: string) => {
      urls.push(url)
      const p = Number(new URL(url).searchParams.get('page'))
      return json(p === 1 ? page(1, 100) : page(2, 3), { headers: { etag: `"p${p}"` } })
    }) as unknown as typeof fetch
    const res = await fetchReleases(opts(data, f))
    expect(res.releases).toHaveLength(103)
    expect(urls).toHaveLength(2)
  })

  it('stops at five pages', async () => {
    const data = tmpDir()
    let calls = 0
    const f = (async () => {
      calls++
      return json(Array.from({ length: 100 }, (_, i) => rel(`spoken/v1.0.${calls * 100 + i}`, null)), { headers: { etag: `"${calls}"` } })
    }) as unknown as typeof fetch
    const res = await fetchReleases(opts(data, f))
    expect(calls).toBe(5)
    expect(res.releases).toHaveLength(500)
  })

  it('reports the rate limit in plain words and keeps the cached list', async () => {
    const data = tmpDir()
    let limited = false
    const f = (async () => {
      if (limited) {
        return new Response('{}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) }
        })
      }
      return json([rel('spoken/v1.0.0', 'Spoken-1.0.0.zip')], { headers: { etag: '"1"' } })
    }) as unknown as typeof fetch
    await fetchReleases(opts(data, f))
    limited = true
    const res = await fetchReleases(opts(data, f))
    expect(res.offline).toBe(true)
    expect(res.rateLimited).toBe(true)
    expect(res.error).toMatch(/limiting how often/)
    expect(res.error).toMatch(/Try again after/)
    expect(res.releases).toHaveLength(1)
  })

  it('treats 429 as a rate limit and a plain 403 as an error', async () => {
    const data = tmpDir()
    const f429 = (async () => new Response('', { status: 429, headers: { 'retry-after': '120' } })) as unknown as typeof fetch
    const r1 = await fetchReleases(opts(data, f429))
    expect(r1.rateLimited).toBe(true)
    expect(r1.error).toMatch(/2 minutes/)
    const f403 = (async () => new Response('', { status: 403 })) as unknown as typeof fetch
    const r2 = await fetchReleases(opts(data, f403))
    expect(r2.rateLimited).toBe(false)
    expect(r2.offline).toBe(true)
  })

  it('returns the cached data with offline=true on a network failure, and nothing when there is no cache', async () => {
    const data = tmpDir()
    const ok = (async () => json([rel('spoken/v1.0.0', 'Spoken-1.0.0.zip')], { headers: { etag: '"1"' } })) as unknown as typeof fetch
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const empty = await fetchReleases(opts(tmpDir(), down))
    expect(empty).toMatchObject({ offline: true, releases: [], fetchedAt: null })
    expect(empty.error).toMatch(/Could not reach GitHub/)

    await fetchReleases(opts(data, ok))
    const res = await fetchReleases(opts(data, down))
    expect(res.offline).toBe(true)
    expect(res.releases).toHaveLength(1)
    expect(res.fetchedAt).not.toBeNull()
  })

  it('treats an answer that is not a list as a failure', async () => {
    const data = tmpDir()
    const f = (async () => json({ message: 'weird' })) as unknown as typeof fetch
    const res = await fetchReleases(opts(data, f))
    expect(res.offline).toBe(true)
    expect(fs.existsSync(path.join(data, 'github-cache'))).toBe(false)
  })
})

describe('buildCatalog', () => {
  const meta = { fetchedAt: '2026-10-18T00:00:00Z' }

  it('reads versions from tags and picks the matching asset', () => {
    const c = buildCatalog(
      [
        rel('spoken/v3.5.0', 'Spoken-3.5.0.zip', { digest: DIGEST, size: 4321 }),
        rel('quests-audio/v2', 'SpokenQuestsAudioAll-2.zip', { size: 1_400_000_000 }),
        rel('quests-audio-deDE/v1', 'SpokenQuestsAudio_deDE-1.zip'),
        rel('places-audio/v1.1', 'SpokenPlacesAudio-1.1.zip'),
        rel('manager/v0.1.0', 'Spoken-Manager-Setup-0.1.0.exe'),
        rel('v9.9.9', 'Spoken-9.9.9.zip')
      ],
      meta
    )
    expect(Object.keys(c.releases).sort()).toEqual(['places-audio', 'quests-audio', 'quests-audio-deDE', 'spoken'])
    expect(c.releases['quests-audio-deDE']![0]!.assetName).toBe('SpokenQuestsAudio_deDE-1.zip')
    const s = c.releases.spoken![0]!
    expect(s).toMatchObject({
      productId: 'spoken',
      tag: 'spoken/v3.5.0',
      version: '3.5.0',
      prerelease: false,
      notes: 'notes of spoken/v3.5.0',
      assetName: 'Spoken-3.5.0.zip',
      assetSize: 4321,
      digest: DIGEST,
      htmlUrl: 'https://github.com/rusty-key/spoken-wow/releases/tag/spoken/v3.5.0'
    })
    expect(s.assetUrl).toContain('/spoken/v3.5.0/Spoken-3.5.0.zip')
    expect(c.releases['quests-audio']![0]!.assetSize).toBe(1_400_000_000)
    expect(c.fetchedAt).toBe(meta.fetchedAt)
    expect(c.offline).toBe(false)
  })

  it('does not mix a product with another whose id starts the same way', () => {
    const c = buildCatalog([rel('quests-audio-alliance/v1', 'SpokenQuestsAudioAlliance-1.zip')], meta)
    expect(Object.keys(c.releases)).toEqual(['quests-audio-alliance'])
  })

  it('skips drafts, releases with no matching asset (case-sensitive) and bad versions', () => {
    const c = buildCatalog(
      [
        rel('spoken/v1.0.0', 'Spoken-1.0.0.zip', { draft: true }),
        rel('spoken/v1.1.0', 'spoken-1.1.0.zip'),
        rel('spoken/v1.2.0', null),
        rel('spoken/vlatest', 'Spoken-latest.zip'),
        rel('spoken/v1.3.0', 'Spoken-1.3.0.zip')
      ],
      meta
    )
    expect(c.releases.spoken!.map((r) => r.version)).toEqual(['1.3.0'])
  })

  it('keeps a digest only when it is sha256:<64 hex>', () => {
    const c = buildCatalog(
      [
        rel('spoken/v1.0.0', 'Spoken-1.0.0.zip', { digest: 'sha1:abc' }),
        rel('spoken/v1.0.1', 'Spoken-1.0.1.zip', { digest: DIGEST.toUpperCase().replace('SHA256', 'sha256') }),
        rel('spoken/v1.0.2', 'Spoken-1.0.2.zip')
      ],
      meta
    )
    const byVersion = Object.fromEntries(c.releases.spoken!.map((r) => [r.version, r.digest]))
    expect(byVersion['1.0.0']).toBeUndefined()
    expect(byVersion['1.0.1']).toBe(DIGEST)
    expect(byVersion['1.0.2']).toBeUndefined()
  })

  it('sorts newest first by version, then date, with a release before its own pre-release', () => {
    const c = buildCatalog(
      [
        rel('spoken/v3.10.0', 'Spoken-3.10.0.zip'),
        rel('spoken/v3.9.0', 'Spoken-3.9.0.zip'),
        rel('spoken/v3.10.0-alpha.1', 'Spoken-3.10.0-alpha.1.zip', { prerelease: true }),
        rel('spoken/v3.10.0-alpha.2', 'Spoken-3.10.0-alpha.2.zip', { prerelease: true }),
        rel('spoken/v3.11.0-beta.1', 'Spoken-3.11.0-beta.1.zip', { prerelease: true }),
        rel('spoken/v3.9.0', 'Spoken-3.9.0.zip', { published_at: '2026-11-01T00:00:00Z' })
      ],
      meta
    )
    expect(c.releases.spoken!.map((r) => `${r.version}@${r.publishedAt.slice(0, 7)}`)).toEqual([
      '3.11.0-beta.1@2026-10',
      '3.10.0@2026-10',
      '3.10.0-alpha.2@2026-10',
      '3.10.0-alpha.1@2026-10',
      '3.9.0@2026-11',
      '3.9.0@2026-10'
    ])
    expect(c.releases.spoken![0]!.prerelease).toBe(true)
  })

  it('carries offline and error', () => {
    const c = buildCatalog([], { fetchedAt: null, offline: true, error: 'down' })
    expect(c).toEqual({ fetchedAt: null, offline: true, error: 'down', releases: {} })
  })
})

describe('latestFor', () => {
  const catalog = buildCatalog(
    [
      rel('spoken/v3.5.0-beta.1', 'Spoken-3.5.0-beta.1.zip', { prerelease: true }),
      rel('spoken/v3.4.0', 'Spoken-3.4.0.zip'),
      rel('spoken/v3.3.0', 'Spoken-3.3.0.zip'),
      rel('places-audio/v2.0.0-alpha.1', 'SpokenPlacesAudio-2.0.0-alpha.1.zip', { prerelease: true }),
      rel('readables-audio/v1.0.0', 'SpokenReadablesAudio-1.0.0.zip', { prerelease: true })
    ],
    { fetchedAt: null }
  )

  it('offers a pre-release only when allowed', () => {
    expect(latestFor(catalog, 'spoken', false)!.version).toBe('3.4.0')
    expect(latestFor(catalog, 'spoken', true)!.version).toBe('3.5.0-beta.1')
  })

  it('has nothing when only pre-releases exist and they are not allowed', () => {
    expect(latestFor(catalog, 'places-audio', false)).toBeUndefined()
    expect(latestFor(catalog, 'places-audio', true)!.version).toBe('2.0.0-alpha.1')
  })

  it('treats a GitHub-flagged pre-release with a plain version as a pre-release, after a stable one of that version', () => {
    expect(latestFor(catalog, 'readables-audio', false)).toBeUndefined()
    const both = buildCatalog(
      [rel('spoken/v4.0.0', 'Spoken-4.0.0.zip', { prerelease: true }), rel('spoken/v4.0.0', 'Spoken-4.0.0.zip')],
      { fetchedAt: null }
    )
    expect(latestFor(both, 'spoken', true)!.prerelease).toBe(false)
  })

  it('is undefined for an unknown product', () => {
    expect(latestFor(catalog, 'nope', true)).toBeUndefined()
  })
})

describe('catalog on disk', () => {
  it('round-trips', () => {
    const data = tmpDir()
    expect(loadCatalog(data)).toEqual({ fetchedAt: null, offline: false, releases: {} })
    const c = buildCatalog([rel('spoken/v1.0.0', 'Spoken-1.0.0.zip')], { fetchedAt: '2026-10-18T00:00:00Z' })
    saveCatalog(data, c)
    expect(loadCatalog(data)).toEqual(c)
  })

  it('ignores a damaged file', () => {
    const data = tmpDir()
    fs.writeFileSync(path.join(data, 'catalog.json'), '{not json')
    expect(loadCatalog(data).releases).toEqual({})
  })
})

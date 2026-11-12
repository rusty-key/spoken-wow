import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CHANNELS } from '../src/shared/api'
import { communityFolder, type CommunityPack, type JobProgress } from '../src/shared/types'
import {
  communityProduct,
  communityRelease,
  fetchCommunity,
  isAllowedPackUrl,
  isCommunityProductId,
  validatePack,
  validateRegistry
} from '../src/main/community'
import { PlainError } from '../src/main/errors'
import { installProduct, uninstallProduct, type JobContext } from '../src/main/install'
import { ManagerService } from '../src/main/service'
import { loadState } from '../src/main/state'
import { collect, makeGame, rawZip, serveBuffer, sha256, startServer, tmpDir, toc, write, yazlZip, type TestServer, type ZipEntry } from './helpers'

const URL_OK = 'https://github.com/someone/their-pack/releases/download/v1.0.0/Pack.zip'

function pack(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'elune-quests-de',
    title: 'Elune Quests',
    author: 'Elune',
    description: 'Quests read by a team of friends.',
    lang: 'deDE',
    section: 'quests',
    version: '1.0.0',
    size: 1234,
    sha256: 'ab'.repeat(32),
    url: URL_OK,
    homepage: 'https://example.com/elune',
    license: 'CC-BY-4.0',
    addedAt: '2026-10-18',
    ...extra
  }
}

describe('validatePack', () => {
  it('accepts a good entry and lower-cases the checksum', () => {
    const res = validatePack(pack({ sha256: 'AB'.repeat(32) }))
    expect(res).toMatchObject({ pack: { id: 'elune-quests-de', sha256: 'ab'.repeat(32), size: 1234, lang: 'deDE' } })
  })

  it('accepts an entry without homepage and license, and an objects.githubusercontent.com url', () => {
    const { homepage: _h, license: _l, ...rest } = pack()
    expect('pack' in validatePack({ ...rest, url: 'https://objects.githubusercontent.com/github-production-release-asset/1/2' })).toBe(true)
  })

  it('accepts any language code of the form xxYY, one the Voice Packs page does not list', () => {
    expect(validatePack(pack({ lang: 'heIL' }))).toMatchObject({ pack: { lang: 'heIL' } })
  })

  it('refuses a language that is no code as an unknown language', () => {
    expect(validatePack(pack({ lang: 'hebrew' }))).toEqual({ reason: 'unknown language' })
  })

  const bad: [string, Record<string, unknown>][] = [
    ['an id with capitals', { id: 'Elune' }],
    ['an id with an underscore', { id: 'a_b' }],
    ['an id with a leading hyphen', { id: '-a' }],
    ['an id with a double hyphen', { id: 'a--b' }],
    ['an id with a slash', { id: '../x' }],
    ['an empty id', { id: '' }],
    ['an id over 48 characters', { id: 'a'.repeat(49) }],
    ['a numeric id', { id: 5 }],
    ['a language that is no code', { lang: 'hebrew' }],
    ['a language in the wrong case', { lang: 'dede' }],
    ['an unknown section', { section: 'music' }],
    ['no title', { title: '' }],
    ['a title over 80 characters', { title: 'x'.repeat(81) }],
    ['a control character in the author', { author: 'a\u0000b' }],
    ['an over-long description', { description: 'x'.repeat(401) }],
    ['a version that is not a version', { version: 'latest' }],
    ['a version with a space', { version: '1.0 beta' }],
    ['a numeric version', { version: 1 }],
    ['a zero size', { size: 0 }],
    ['a negative size', { size: -5 }],
    ['a fractional size', { size: 1.5 }],
    ['a size given as text', { size: '1234' }],
    ['a size over the limit', { size: 9 * 1024 ** 3 }],
    ['a short sha256', { sha256: 'ab'.repeat(31) }],
    ['a non-hex sha256', { sha256: 'zz'.repeat(32) }],
    ['a missing sha256', { sha256: undefined }],
    ['an http url', { url: URL_OK.replace('https', 'http') }],
    ['a url on another host', { url: 'https://evil.example/someone/pack/releases/download/v1/p.zip' }],
    ['a url that only mentions github.com', { url: 'https://github.com.evil.example/a/b/releases/download/v1/p.zip' }],
    ['a github url that is not a release asset', { url: 'https://github.com/someone/pack/archive/main.zip' }],
    ['a github url with a query', { url: `${URL_OK}?x=1` }],
    ['a url with credentials', { url: 'https://user:pw@github.com/a/b/releases/download/v1/p.zip' }],
    ['a url with a port', { url: 'https://github.com:8443/a/b/releases/download/v1/p.zip' }],
    ['a file url', { url: 'file:///C:/Windows/x.zip' }],
    ['an http homepage', { homepage: 'http://example.com' }],
    ['a javascript homepage', { homepage: 'javascript:alert(1)' }],
    ['a homepage that is not a url', { homepage: 'my page' }],
    ['an empty license', { license: '' }],
    ['a bad date', { addedAt: '18/10/2026' }],
    ['no date', { addedAt: undefined }]
  ]
  for (const [name, patch] of bad) {
    it(`refuses ${name}`, () => {
      expect('reason' in validatePack(pack(patch))).toBe(true)
    })
  }

  it('refuses things that are not objects', () => {
    for (const v of [null, 5, 'x', [], undefined]) expect('reason' in validatePack(v)).toBe(true)
  })

  it('checks urls on their own', () => {
    expect(isAllowedPackUrl(URL_OK)).toBe(true)
    expect(isAllowedPackUrl('https://github.com/a/b/releases/download/v1/a%20b.zip')).toBe(true)
    expect(isAllowedPackUrl('https://github.com/a/b/releases/latest/download/p.zip')).toBe(false)
    expect(isAllowedPackUrl('https://github.com/a/b/releases/download/v1/x/y.zip')).toBe(false)
    expect(isAllowedPackUrl(5)).toBe(false)
  })
})

describe('validateRegistry', () => {
  it('keeps the good entries, drops the bad ones and duplicate ids', () => {
    const packs = validateRegistry({
      packs: [pack(), pack({ id: 'second' }), { nonsense: true }, pack({ id: 'elune-quests-de', title: 'Duplicate' }), pack({ id: 'third', size: 0 })]
    })
    expect(packs.map((p) => p.id)).toEqual(['elune-quests-de', 'second'])
    expect(packs[0]!.title).toBe('Elune Quests')
  })

  it('accepts an empty list and refuses a file of the wrong shape', () => {
    expect(validateRegistry({ packs: [] })).toEqual([])
    for (const v of [null, [], { packs: 'x' }, { list: [] }, 'x']) expect(() => validateRegistry(v)).toThrow()
  })

  it('reads at most 500 entries', () => {
    const many = Array.from({ length: 600 }, (_, i) => pack({ id: `p${i}` }))
    expect(validateRegistry({ packs: many })).toHaveLength(500)
  })
})

describe('products from the registry', () => {
  it('builds a product and a release the ordinary installer can use', () => {
    const p = (validatePack(pack()) as { pack: CommunityPack }).pack
    const product = communityProduct(p)
    expect(product).toMatchObject({
      id: 'community/elune-quests-de',
      kind: 'community',
      folders: ['SpokenCommunity_elune-quests-de'],
      lang: 'deDE',
      section: 'quests'
    })
    expect(communityFolder(p.id)).toBe(product.folders![0])
    const rel = communityRelease(p)
    expect(rel).toMatchObject({
      productId: 'community/elune-quests-de',
      tag: 'community/elune-quests-de/v1.0.0',
      version: '1.0.0',
      assetName: 'Pack.zip',
      assetSize: 1234,
      assetUrl: URL_OK,
      digest: `sha256:${'ab'.repeat(32)}`
    })
    expect(isCommunityProductId('community/elune-quests-de')).toBe(true)
    expect(isCommunityProductId('community/../x')).toBe(false)
    expect(isCommunityProductId('spoken')).toBe(false)
  })
})

describe('fetchCommunity', () => {
  const body = JSON.stringify({ packs: [pack(), { bad: 1 }] })
  const run = (data: string, f: typeof fetch) => fetchCommunity({ dataPath: data, appVersion: '0.1.0', fetchImpl: f })

  it('fetches with the right headers, validates, and caches by ETag', async () => {
    const data = tmpDir()
    const seen: { url: string; headers: Record<string, string> }[] = []
    const f = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      seen.push({ url, headers })
      if (headers['If-None-Match'] === '"v1"') return new Response(null, { status: 304 })
      return new Response(body, { status: 200, headers: { etag: '"v1"' } })
    }) as unknown as typeof fetch
    const first = await run(data, f)
    expect(first).toMatchObject({ offline: false })
    expect(first.packs.map((p) => p.id)).toEqual(['elune-quests-de'])
    const second = await run(data, f)
    expect(second.offline).toBe(false)
    expect(second.packs).toEqual(first.packs)
    expect(seen[0]!.url).toBe('https://spoken.quest/api/community/packs')
    expect(seen[0]!.headers['User-Agent']).toBe('SpokenManager/0.1.0')
    expect(seen[1]!.headers['If-None-Match']).toBe('"v1"')
    expect(Object.keys(seen[0]!.headers).map((k) => k.toLowerCase())).not.toContain('authorization')
  })

  it('keeps the cached packs and says offline when the network or GitHub fails', async () => {
    const data = tmpDir()
    await run(data, (async () => new Response(body, { status: 200, headers: { etag: '"v1"' } })) as unknown as typeof fetch)
    const down = await run(data, (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch)
    expect(down).toMatchObject({ offline: true })
    expect(down.error).toMatch(/Could not reach GitHub/)
    expect(down.packs).toHaveLength(1)
    const limited = await run(data, (async () => new Response('', { status: 429 })) as unknown as typeof fetch)
    expect(limited.offline).toBe(true)
    expect(limited.packs).toHaveLength(1)
    expect(limited.error).toMatch(/limiting/)
  })

  it('does not replace a good cache with a broken answer', async () => {
    const data = tmpDir()
    await run(data, (async () => new Response(body, { status: 200, headers: { etag: '"v1"' } })) as unknown as typeof fetch)
    for (const bad of ['{not json', '{"list": []}', '[]']) {
      const res = await run(data, (async () => new Response(bad, { status: 200, headers: { etag: '"v2"' } })) as unknown as typeof fetch)
      expect(res.offline).toBe(true)
      expect(res.packs).toHaveLength(1)
    }
    const again = await run(data, (async () => new Response(null, { status: 304 })) as unknown as typeof fetch)
    expect(again.packs).toHaveLength(1)
  })

  it('treats a missing registry file (404) as an empty list', async () => {
    const res = await run(tmpDir(), (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch)
    expect(res).toMatchObject({ offline: false, packs: [] })
  })

  it('is offline with nothing when there is no cache and no network', async () => {
    const res = await run(tmpDir(), (async () => {
      throw new TypeError('down')
    }) as unknown as typeof fetch)
    expect(res).toMatchObject({ offline: true, packs: [], fetchedAt: null })
  })

  it('refuses an over-large answer', async () => {
    const res = await run(tmpDir(), (async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 })) as unknown as typeof fetch)
    expect(res.offline).toBe(true)
  })
})

// ---------------------------------------------------------------- install

let server: TestServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})

const ID = 'elune-quests-de'
const FOLDER = communityFolder(ID)

async function communityEnv() {
  const base = tmpDir()
  const game = await makeGame(base)
  write(path.join(game.root, 'WTF', 'Account', 'ME.lua'), 'saved')
  return { game, data: tmpDir(), downloads: tmpDir(), addOns: game.addOnsPath, wtf: path.join(game.root, 'WTF') }
}

function packEntries(version = '1.0.0', folder = FOLDER): ZipEntry[] {
  return [
    { name: `${folder}/${folder}.toc`, data: toc(folder, version) },
    { name: `${folder}/Data/lines.lua`, data: 'x'.repeat(2000) }
  ]
}

async function prepare(zip: Buffer, extra: Record<string, unknown> = {}, version = '1.0.0') {
  await server?.close()
  server = await startServer((req, res) => serveBuffer(req, res, zip))
  const p = (validatePack(pack({ id: ID, version, size: zip.length, sha256: sha256(zip), ...extra })) as { pack: CommunityPack }).pack
  const product = communityProduct(p)
  const release = { ...communityRelease(p), assetUrl: `${server.url}/pack.zip` }
  return { product, release }
}

function ctx(env: { data: string; downloads: string }, extra: Partial<JobContext> = {}) {
  const { events, emit } = collect()
  return { jobId: 'job1', dataPath: env.data, downloadsPath: env.downloads, keepDownloads: false, emit, backoffMs: 1, attempts: 1, isRunning: async () => false, events, ...extra }
}

describe('installing a community pack', () => {
  it('installs the one folder and records it', async () => {
    const env = await communityEnv()
    const { product, release } = await prepare(await yazlZip(packEntries()))
    await installProduct(env.game, product, release, ctx(env))
    expect(fs.readFileSync(path.join(env.addOns, FOLDER, `${FOLDER}.toc`), 'utf8')).toContain('## Version: 1.0.0')
    expect(loadState(env.data).installs[env.game.id]!['community/elune-quests-de']).toMatchObject({
      version: '1.0.0',
      folders: [FOLDER],
      tag: 'community/elune-quests-de/v1.0.0'
    })
    expect(fs.readdirSync(env.addOns).filter((n) => n !== '.spoken-manager')).toEqual([FOLDER])
  })

  async function refused(zip: Buffer | ZipEntry[], extra: Record<string, unknown> = {}, pattern?: RegExp): Promise<void> {
    const env = await communityEnv()
    write(path.join(env.addOns, 'SpokenQuestsAudio_deDE', 'keep.lua'), 'official pack')
    write(path.join(env.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.5.0'))
    const buf = Buffer.isBuffer(zip) ? zip : rawZip(zip)
    const { product, release } = await prepare(buf, extra)
    const before = fs.readdirSync(env.addOns).sort()
    const wtf = fs.readdirSync(path.join(env.wtf, 'Account')).length
    const err = await installProduct(env.game, product, release, ctx(env)).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    if (pattern) expect(err.message).toMatch(pattern)
    expect(fs.readdirSync(env.addOns).sort().filter((n) => n !== '.spoken-manager')).toEqual(before.filter((n) => n !== '.spoken-manager'))
    expect(fs.readFileSync(path.join(env.addOns, 'SpokenQuestsAudio_deDE', 'keep.lua'), 'utf8')).toBe('official pack')
    expect(fs.readdirSync(path.join(env.wtf, 'Account')).length).toBe(wtf)
    expect(loadState(env.data).installs).toEqual({})
  }

  it('refuses a zip with another folder next to its own', async () => {
    await refused([...packEntries(), { name: 'Spoken_Places/Spoken_Places.toc', data: toc('Spoken_Places', '9') }], {}, /may not install/)
  })

  it('refuses a zip that replaces an official folder instead', async () => {
    await refused([{ name: 'Spoken/Spoken.toc', data: toc('Spoken', '9') }, { name: 'Spoken/Core.lua', data: 'pwned' }])
    await refused([{ name: 'SpokenQuestsAudio_deDE/SpokenQuestsAudio_deDE.toc', data: 'x' }])
  })

  it('refuses another community pack folder', async () => {
    await refused([{ name: 'SpokenCommunity_other/SpokenCommunity_other.toc', data: 'x' }])
  })

  it('refuses path tricks', async () => {
    for (const name of ['../evil.txt', `${FOLDER}/../../evil.txt`, '/evil.txt', 'C:/evil.txt', `${FOLDER}\\..\\evil.txt`]) {
      await refused([...packEntries(), { name, data: 'pwned' }])
    }
  })

  it('refuses a pack with no toc of its own', async () => {
    await refused([{ name: `${FOLDER}/Data.lua`, data: 'x' }], {}, /\.toc is missing/)
  })

  it('refuses a release with no checksum, or a malformed one, before downloading anything', async () => {
    const env = await communityEnv()
    const { product, release } = await prepare(await yazlZip(packEntries()))
    for (const digest of [undefined, 'sha1:abc', `sha256:${'zz'.repeat(32)}`, '']) {
      const { digest: _d, ...rest } = release
      const rel = digest === undefined ? rest : { ...rest, digest }
      const err = await installProduct(env.game, product, rel, ctx(env)).catch((e) => e)
      expect(err).toBeInstanceOf(PlainError)
      expect(err.message).toMatch(/no checksum/)
    }
    expect(server!.requests).toHaveLength(0)
    expect(fs.existsSync(path.join(env.addOns, FOLDER))).toBe(false)
  })

  it('refuses a download whose checksum does not match', async () => {
    const env = await communityEnv()
    const { product, release } = await prepare(await yazlZip(packEntries()), { sha256: '00'.repeat(32) })
    const err = await installProduct(env.game, product, release, ctx(env)).catch((e) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(err.message).toMatch(/does not match/)
    expect(fs.existsSync(path.join(env.addOns, FOLDER))).toBe(false)
  })

  it('refuses a product whose folder is not a SpokenCommunity_ name', async () => {
    const env = await communityEnv()
    const { product, release } = await prepare(await yazlZip(packEntries()))
    for (const folders of [['Spoken'], ['SpokenPlacesAudio'], [FOLDER, 'Spoken'], null]) {
      const err = await installProduct(env.game, { ...product, folders }, release, ctx(env)).catch((e) => e)
      expect(err).toBeInstanceOf(PlainError)
    }
  })

  it('updates in place and removes only its own folder', async () => {
    const env = await communityEnv()
    write(path.join(env.addOns, 'Spoken', 'Spoken.toc'), toc('Spoken', '3.5.0'))
    const v1 = await prepare(await yazlZip(packEntries('1.0.0')))
    await installProduct(env.game, v1.product, v1.release, ctx(env))
    await server!.close()
    const v2 = await prepare(await yazlZip(packEntries('1.1.0')), {}, '1.1.0')
    await installProduct(env.game, v2.product, v2.release, ctx(env))
    expect(fs.readFileSync(path.join(env.addOns, FOLDER, `${FOLDER}.toc`), 'utf8')).toContain('1.1.0')
    expect(fs.existsSync(path.join(env.addOns, '.spoken-manager', 'backup', 'community', ID, FOLDER))).toBe(true)

    const result = await uninstallProduct(env.game, v2.product, ctx(env))
    expect(result.folders).toEqual([FOLDER])
    expect(fs.existsSync(path.join(env.addOns, FOLDER))).toBe(false)
    expect(fs.existsSync(path.join(env.addOns, 'Spoken', 'Spoken.toc'))).toBe(true)
    expect(loadState(env.data).installs).toEqual({})
  })
})

// ---------------------------------------------------------------- through the service

describe('community packs through the service', () => {
  async function serviceEnv(registry: unknown = { packs: [] }) {
    const base = tmpDir()
    const game = await makeGame(base)
    const sent: { channel: string; payload: unknown }[] = []
    let zip = await yazlZip(packEntries('1.0.0'))
    server = await startServer((req, res) => serveBuffer(req, res, zip))
    let current = registry
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url === 'https://spoken.quest/api/community/packs') return new Response(JSON.stringify(current), { status: 200 })
      if (url.startsWith('https://api.github.com/')) return new Response('[]', { status: 200 })
      if (url.startsWith('https://github.com/')) return fetch(`${server!.url}/pack.zip`, init)
      return fetch(url, init)
    }) as unknown as typeof fetch
    const svc = new ManagerService({
      dataPath: tmpDir(),
      appVersion: '0.1.0',
      packsBaseUrl: 'http://127.0.0.1:9/',
      send: (channel, payload) => sent.push({ channel, payload }),
      fetchImpl,
      autoPaths: [game.root],
      isRunning: async () => false,
      backoffMs: 1
    })
    await svc.init()
    return {
      svc,
      game,
      sent,
      setRegistry: (r: unknown) => (current = r),
      setZip: (z: Buffer) => (zip = z),
      entry: async (extra: Record<string, unknown> = {}) => pack({ size: zip.length, sha256: sha256(zip), ...extra })
    }
  }

  function done(sent: { channel: string; payload: unknown }[], jobId: string): Promise<JobProgress> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now()
      const t = setInterval(() => {
        const last = sent.filter((s) => s.channel === CHANNELS.jobProgress && (s.payload as JobProgress).jobId === jobId).map((s) => s.payload as JobProgress).at(-1)
        if (last && ['done', 'error', 'cancelled'].includes(last.phase)) {
          clearInterval(t)
          resolve(last)
        } else if (Date.now() - t0 > 10000) {
          clearInterval(t)
          reject(new Error('timeout'))
        }
      }, 10)
    })
  }

  it('refreshes, shows the pack in the snapshot and statuses, installs, reports an update, and removes', async () => {
    const env = await serviceEnv()
    const entry = await env.entry()
    env.setRegistry({ packs: [entry, { broken: true }] })
    const catalog = await env.svc.refreshCommunity(true)
    expect(catalog.packs.map((p) => p.id)).toEqual([ID])
    expect(env.sent.some((s) => s.channel === CHANNELS.communityChanged)).toBe(true)
    expect(env.svc.snapshot().community.packs).toHaveLength(1)
    expect(env.svc.snapshot().products.some((p) => p.kind === 'community')).toBe(false)

    const id = `community/${ID}`
    let status = (await env.svc.statuses(env.game.id)).find((s) => s.productId === id)!
    expect(status).toMatchObject({ state: 'not-installed', latest: { version: '1.0.0', digest: `sha256:${(entry as { sha256: string }).sha256}` } })

    expect((await done(env.sent, env.svc.install(env.game.id, id))).phase).toBe('done')
    status = (await env.svc.statuses(env.game.id)).find((s) => s.productId === id)!
    expect(status).toMatchObject({ state: 'up-to-date', installedVersion: '1.0.0', installedFolders: [FOLDER] })

    // The registry moves to 1.1.0.
    const zip2 = await yazlZip(packEntries('1.1.0'))
    env.setZip(zip2)
    env.setRegistry({ packs: [await env.entry({ version: '1.1.0' })] })
    await env.svc.refreshCommunity(true)
    status = (await env.svc.statuses(env.game.id)).find((s) => s.productId === id)!
    expect(status).toMatchObject({ state: 'update-available', installedVersion: '1.0.0', latest: { version: '1.1.0' } })
    expect((await done(env.sent, env.svc.install(env.game.id, id))).phase).toBe('done')
    expect((await env.svc.statuses(env.game.id)).find((s) => s.productId === id)!.state).toBe('up-to-date')

    // The pack leaves the registry: it still shows, and can still be removed.
    env.setRegistry({ packs: [] })
    await env.svc.refreshCommunity(true)
    status = (await env.svc.statuses(env.game.id)).find((s) => s.productId === id)!
    expect(status).toMatchObject({ state: 'unknown', installedFolders: [FOLDER] })
    expect((await done(env.sent, env.svc.uninstall(env.game.id, id))).phase).toBe('done')
    expect((await env.svc.statuses(env.game.id)).find((s) => s.productId === id)).toBeUndefined()
  })

  it('reports a bad checksum as an error job and installs nothing', async () => {
    const env = await serviceEnv()
    env.setRegistry({ packs: [await env.entry({ sha256: '11'.repeat(32) })] })
    await env.svc.refreshCommunity(true)
    const end = await done(env.sent, env.svc.install(env.game.id, `community/${ID}`))
    expect(end.phase).toBe('error')
    expect(end.message).toMatch(/does not match/)
    expect(fs.existsSync(path.join(env.game.addOnsPath, FOLDER))).toBe(false)
  })

  it('does not ask GitHub again within the cache window unless forced, and rejects unknown ids', async () => {
    const env = await serviceEnv()
    await env.svc.refreshCommunity(true)
    const first = env.svc.community
    expect(await env.svc.refreshCommunity()).toBe(first)
    expect(() => env.svc.install(env.game.id, 'community/nope')).toThrow(/Unknown product/)
  })
})

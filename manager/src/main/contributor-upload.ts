// Zips an installed pack and sends it to CurseForge or GitHub, the way
// scripts/maintainers/spoken-release.sh does. Every failure is a PlainError whose text never
// holds a token, since these messages reach the window.
import fs from 'node:fs'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import { CancelledError, isAbortError, PlainError } from './errors'

const CF_API = 'https://wow.curseforge.com/api'
const GH_API = 'https://api.github.com'
const GH_UPLOADS = 'https://uploads.github.com'

/** Server text shown to the player: short, and without the secret it may echo back. */
function scrub(text: string, token: string): string {
  const clean = token ? text.split(token).join('[token]') : text
  return clean.length > 500 ? `${clean.slice(0, 500)}...` : clean
}

async function bodyText(res: Response, token: string): Promise<string> {
  try {
    return scrub((await res.text()).trim(), token)
  } catch {
    return ''
  }
}

/** A fetch whose network failures read as words; a cancel passes through untouched. */
async function send(
  store: string,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Response> {
  if (signal?.aborted) throw new CancelledError()
  try {
    return await fetchImpl(url, { ...init, signal })
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw new CancelledError()
    throw new PlainError(`Could not reach ${store}.`)
  }
}

async function rejected(store: string, res: Response, token: string): Promise<PlainError> {
  const text = await bodyText(res, token)
  return new PlainError(`${store} answered HTTP ${res.status}${text ? `: ${text}` : ''}`)
}

// ---------------------------------------------------------------- zip

async function filesUnder(dir: string, prefix: string, out: Array<[string, string]>): Promise<void> {
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue
    const full = path.join(dir, entry.name)
    const inZip = `${prefix}/${entry.name}`
    if (entry.isDirectory()) await filesUnder(full, inZip, out)
    else if (entry.isFile()) out.push([full, inZip])
  }
}

/** Stores `<addOns>/<folder>` in `dest` with `<folder>/` as the root. The clips are Ogg already, so nothing is compressed. */
export async function zipFolder(addOns: string, folder: string, dest: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new CancelledError()
  const files: Array<[string, string]> = []
  await filesUnder(path.join(addOns, folder), folder, files)
  const zip = new yazl.ZipFile()
  for (const [full, inZip] of files) zip.addFile(full, inZip, { compress: false })
  zip.end()
  try {
    await pipeline(zip.outputStream, createWriteStream(dest), { signal })
  } catch (err) {
    await fs.promises.rm(dest, { force: true })
    if (isAbortError(err) || signal.aborted) throw new CancelledError()
    throw new PlainError(`Could not zip ${folder}.`)
  }
}

// ---------------------------------------------------------------- CurseForge

const cfHeaders = (token: string): Record<string, string> => ({ 'X-Api-Token': token })

async function listGameVersions(token: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  const res = await send('CurseForge', fetchImpl, `${CF_API}/game/versions`, { headers: cfHeaders(token) }, signal)
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new PlainError('CurseForge did not accept that token.')
    throw await rejected('CurseForge', res, token)
  }
  try {
    return await res.json()
  } catch {
    throw new PlainError("CurseForge's list of game versions could not be read.")
  }
}

export async function checkCfToken(token: string, fetchImpl: typeof fetch): Promise<void> {
  await listGameVersions(token, fetchImpl)
}

/** A name that matches no entry, or two, would file the pack under the wrong client, so it stops the run. */
export async function resolveGameVersions(token: string, names: string, fetchImpl: typeof fetch): Promise<number[]> {
  const list = await listGameVersions(token, fetchImpl)
  if (!Array.isArray(list)) throw new PlainError("CurseForge's list of game versions could not be read.")
  const ids: number[] = []
  for (const name of names.split(/\s+/).filter(Boolean)) {
    const hits = list.filter((v: { name?: unknown }) => v && v.name === name) as Array<{ id?: unknown }>
    if (hits.length !== 1 || typeof hits[0]?.id !== 'number') {
      throw new PlainError(`CurseForge has ${hits.length} game versions named ${name}. Change the game versions under Stores.`)
    }
    ids.push(hits[0]!.id)
  }
  return ids
}

export async function uploadCurseForge(a: {
  token: string
  project: string
  folder: string
  version: string
  zip: string
  notes: string
  gameVersionIds: number[]
  signal: AbortSignal
  fetchImpl: typeof fetch
}): Promise<{ fileId: string | null; link: string }> {
  const metadata = {
    changelog: a.notes,
    changelogType: 'markdown',
    displayName: `${a.folder} ${a.version}`,
    gameVersions: a.gameVersionIds,
    releaseType: 'release',
    relations: { projects: [{ slug: 'spoken', type: 'requiredDependency' }] }
  }
  const form = new FormData()
  form.set('metadata', JSON.stringify(metadata))
  // openAsBlob reads from disk as the body is sent, so a large pack is not held in memory.
  form.set('file', await fs.openAsBlob(a.zip), path.basename(a.zip))
  const res = await send(
    'CurseForge',
    a.fetchImpl,
    `${CF_API}/projects/${encodeURIComponent(a.project)}/upload-file`,
    { method: 'POST', headers: cfHeaders(a.token), body: form },
    a.signal
  )
  if (res.status === 413) throw new PlainError(`${a.folder} is over CurseForge's upload limit (HTTP 413).`)
  if (!res.ok) throw await rejected('CurseForge', res, a.token)
  let fileId: string | null = null
  try {
    const id = ((await res.json()) as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') fileId = String(id)
  } catch {
    // The file is up; only its id is unknown.
  }
  return { fileId, link: `https://www.curseforge.com/projects/${encodeURIComponent(a.project)}` }
}

// ---------------------------------------------------------------- GitHub

const ghHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
})

function checkRepoName(repo: string): void {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new PlainError('The GitHub repository must look like owner/repo.')
}

/** Refuses a repository the token cannot push to, before a run sends anything. */
export async function checkGhRepo(token: string, repo: string, fetchImpl: typeof fetch): Promise<void> {
  checkRepoName(repo)
  const res = await send('GitHub', fetchImpl, `${GH_API}/repos/${repo}`, { headers: ghHeaders(token) })
  if (res.status === 401) throw new PlainError('GitHub did not accept that token.')
  if (res.status === 404) throw new PlainError(`GitHub shows no repository ${repo} to that token.`)
  if (!res.ok) throw await rejected('GitHub', res, token)
  let push: unknown
  try {
    push = ((await res.json()) as { permissions?: { push?: unknown } }).permissions?.push
  } catch {
    push = undefined
  }
  if (push !== true) throw new PlainError(`That token cannot push to ${repo}: it needs write access.`)
}

interface GhRelease {
  id?: unknown
  upload_url?: unknown
  assets?: Array<{ name?: unknown }>
}

/** A release already holding this zip is left alone, so a re-run sends only what is missing. */
export async function uploadGitHub(a: {
  token: string
  repo: string
  folder: string
  version: string
  zip: string
  notes: string
  signal: AbortSignal
  fetchImpl: typeof fetch
}): Promise<{ link: string; alreadyThere: boolean }> {
  checkRepoName(a.repo)
  const tag = `${a.folder}/v${a.version}`
  const name = `${a.folder}-${a.version}.zip`
  const link = `https://github.com/${a.repo}/releases/tag/${tag}`
  const headers = ghHeaders(a.token)

  let res = await send('GitHub', a.fetchImpl, `${GH_API}/repos/${a.repo}/releases/tags/${tag}`, { headers }, a.signal)
  if (res.status === 404) {
    res = await send(
      'GitHub',
      a.fetchImpl,
      `${GH_API}/repos/${a.repo}/releases`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ tag_name: tag, name: `${a.folder} ${a.version}`, body: a.notes })
      },
      a.signal
    )
  }
  if (!res.ok) throw await rejected('GitHub', res, a.token)
  let release: GhRelease
  try {
    release = (await res.json()) as GhRelease
  } catch {
    throw new PlainError("GitHub's answer could not be read.")
  }
  if (release.assets?.some((x) => x.name === name)) return { link, alreadyThere: true }

  const fromUrl = typeof release.upload_url === 'string' ? /\/releases\/(\d+)\/assets/.exec(release.upload_url)?.[1] : undefined
  const id = fromUrl ?? (typeof release.id === 'number' ? String(release.id) : undefined)
  if (!id) throw new PlainError("GitHub's answer names no release id.")

  const size = (await fs.promises.stat(a.zip)).size
  const stream = createReadStream(a.zip)
  const up = await send(
    'GitHub',
    a.fetchImpl,
    `${GH_UPLOADS}/repos/${a.repo}/releases/${id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/zip', 'Content-Length': String(size) },
      // Streamed: the biggest pack of a language would not fit in memory on every machine.
      body: Readable.toWeb(stream) as unknown as BodyInit,
      duplex: 'half'
    } as RequestInit,
    a.signal
  ).finally(() => stream.destroy())
  if (!up.ok) throw await rejected('GitHub', up, a.token)
  return { link, alreadyThere: false }
}

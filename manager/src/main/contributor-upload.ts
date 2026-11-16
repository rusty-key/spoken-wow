// Every failure is a PlainError whose text never holds a token, since these messages reach the window.
import fs from 'node:fs'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import { CancelledError, errorCode, isAbortError, PlainError, withTimeout } from './errors'
import { t } from './i18n'

const CF_API = 'https://wow.curseforge.com/api'
export const GH_API = 'https://api.github.com'
const GH_UPLOADS = 'https://uploads.github.com'
const CHECK_TIMEOUT_MS = 30_000

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

/**
 * Every call carries a token, and a redirect would deliver it to wherever it points. `timeoutMs` is for
 * short calls, not for an upload, whose length depends on the pack.
 */
async function send(
  store: string,
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<Response> {
  if (signal?.aborted) throw new CancelledError()
  try {
    return await fetchImpl(url, { ...init, redirect: 'error', signal: timeoutMs ? withTimeout(timeoutMs, signal) : signal })
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw new CancelledError()
    throw new PlainError(t('upload.reachStore', { store }))
  }
}

async function rejected(store: string, res: Response, token: string): Promise<PlainError> {
  const text = await bodyText(res, token)
  return new PlainError(t('upload.storeHttp', { store, status: res.status, text: text ? `: ${text}` : '' }))
}

// ---------------------------------------------------------------- zip

async function filesUnder(root: string, dir: string, prefix: string, out: Array<[string, string]>): Promise<void> {
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue
    const full = path.join(dir, entry.name)
    const inZip = `${prefix}/${entry.name}`
    if (entry.isDirectory()) await filesUnder(root, full, inZip, out)
    else if (entry.isFile()) out.push([full, inZip])
    else if (entry.isSymbolicLink()) {
      // Leaving a link out would drop clips from a published zip without a word.
      throw new PlainError(t('upload.linkInPack', { path: path.relative(root, full).split(path.sep).join('/') }))
    }
  }
}

/** The zip's root is `<folder>/`. The clips are Ogg already, so nothing is compressed. */
export async function zipFolder(addOns: string, folder: string, dest: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new CancelledError()
  const files: Array<[string, string]> = []
  const root = path.join(addOns, folder)
  try {
    await filesUnder(root, root, folder, files)
  } catch (err) {
    if (err instanceof PlainError) throw err
    if (errorCode(err) === 'ENOENT') throw new PlainError(t('upload.notInstalled', { folder }))
    throw new PlainError(t('upload.cannotRead', { folder }))
  }
  const zip = new yazl.ZipFile()
  // yazl reports a file it cannot read on the ZipFile, not on its output; without this the run hangs.
  zip.on('error', (err) => (zip.outputStream as unknown as Readable).destroy(err))
  for (const [full, inZip] of files) zip.addFile(full, inZip, { compress: false })
  zip.end()
  try {
    await pipeline(zip.outputStream, createWriteStream(dest), { signal })
  } catch (err) {
    await fs.promises.rm(dest, { force: true }).catch(() => undefined)
    if (isAbortError(err) || signal.aborted) throw new CancelledError()
    throw new PlainError(t('upload.cannotZip', { folder }))
  }
}

async function zipSize(zip: string): Promise<number> {
  try {
    return (await fs.promises.stat(zip)).size
  } catch {
    throw new PlainError(t('upload.zipUnreadable'))
  }
}

async function* multipartBody(head: Buffer, file: string, tail: Buffer): AsyncGenerator<Buffer> {
  yield head
  for await (const chunk of createReadStream(file)) yield chunk as Buffer
  yield tail
}

export type UploadProgress = (sent: number, total: number) => void

/** Counts bytes as fetch takes them, so the count runs slightly ahead of what has reached the store. */
async function* counted(source: AsyncIterable<Buffer>, total: number, onProgress?: UploadProgress): AsyncGenerator<Buffer> {
  let sent = 0
  onProgress?.(0, total)
  for await (const chunk of source) {
    yield chunk
    sent += chunk.length
    onProgress?.(sent, total)
  }
}

// ---------------------------------------------------------------- CurseForge

const zipName = (folder: string, version: string): string => `${folder}-${version}.zip`

const cfHeaders = (token: string): Record<string, string> => ({ 'X-Api-Token': token })

export function cfProjectLink(project: string): string {
  return `https://www.curseforge.com/projects/${encodeURIComponent(project)}`
}

async function listGameVersions(token: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  const res = await send('CurseForge', fetchImpl, `${CF_API}/game/versions`, { headers: cfHeaders(token) }, signal, CHECK_TIMEOUT_MS)
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new PlainError(t('upload.cfToken'))
    throw await rejected('CurseForge', res, token)
  }
  try {
    return await res.json()
  } catch {
    if (signal?.aborted) throw new CancelledError()
    throw new PlainError(t('upload.cfVersions'))
  }
}

export async function checkCfToken(token: string, fetchImpl: typeof fetch): Promise<void> {
  await listGameVersions(token, fetchImpl)
}

/** A name that matches no entry, or two, would file the pack under the wrong client, so it stops the run. */
export async function resolveGameVersions(token: string, names: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<number[]> {
  const list = await listGameVersions(token, fetchImpl, signal)
  if (!Array.isArray(list)) throw new PlainError(t('upload.cfVersions'))
  const ids: number[] = []
  for (const name of names.split(/\s+/).filter(Boolean)) {
    const hits = list.filter((v: { name?: unknown }) => v && v.name === name) as Array<{ id?: unknown }>
    if (hits.length !== 1 || typeof hits[0]?.id !== 'number') {
      throw new PlainError(t('upload.cfDuplicate', { count: hits.length, name }))
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
  onProgress?: UploadProgress
}): Promise<{ fileId: string | null; link: string }> {
  const metadata = {
    changelog: a.notes,
    changelogType: 'markdown',
    displayName: `${a.folder} ${a.version}`,
    gameVersions: a.gameVersionIds,
    releaseType: 'release',
    relations: { projects: [{ slug: 'spoken', type: 'requiredDependency' }] }
  }
  const fileName = zipName(a.folder, a.version)
  const boundary = `----spoken${randomBytes(16).toString('hex')}`
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n'
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  const size = head.length + (await zipSize(a.zip)) + tail.length
  const res = await send(
    'CurseForge',
    a.fetchImpl,
    `${CF_API}/projects/${encodeURIComponent(a.project)}/upload-file`,
    {
      method: 'POST',
      headers: {
        ...cfHeaders(a.token),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(size)
      },
      // FormData would read the whole zip into memory before sending; this streams it from disk.
      body: Readable.toWeb(Readable.from(counted(multipartBody(head, a.zip, tail), size, a.onProgress))) as unknown as BodyInit,
      duplex: 'half',
      redirect: 'error'
    } as RequestInit,
    a.signal
  )
  if (res.status === 413) throw new PlainError(t('upload.cfTooBig', { folder: a.folder }))
  if (!res.ok) throw await rejected('CurseForge', res, a.token)
  let fileId: string | null = null
  try {
    const id = ((await res.json()) as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') fileId = String(id)
  } catch {
    // The file is up; only its id is unknown.
  }
  return { fileId, link: cfProjectLink(a.project) }
}

// ---------------------------------------------------------------- GitHub

/** The names both the uploader and the status check must agree on, or a finished run reads as unreleased. */
export function ghRelease(repo: string, folder: string, version: string): { tag: string; asset: string; link: string } {
  const tag = `${folder}/v${version}`
  return { tag, asset: zipName(folder, version), link: `https://github.com/${repo}/releases/tag/${tag}` }
}

export const ghHeaders = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
})

function checkRepoName(repo: string): void {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new PlainError(t('upload.repoShape'))
}

/** Refuses a repository the token cannot push to, before a run sends anything. */
export async function checkGhRepo(token: string, repo: string, fetchImpl: typeof fetch): Promise<void> {
  checkRepoName(repo)
  const res = await send('GitHub', fetchImpl, `${GH_API}/repos/${repo}`, { headers: ghHeaders(token) }, undefined, CHECK_TIMEOUT_MS)
  if (res.status === 401) throw new PlainError(t('upload.ghToken'))
  if (res.status === 404) throw new PlainError(t('upload.ghNoRepo', { repo }))
  if (!res.ok) throw await rejected('GitHub', res, token)
  let push: unknown
  try {
    push = ((await res.json()) as { permissions?: { push?: unknown } }).permissions?.push
  } catch {
    push = undefined
  }
  if (push !== true) throw new PlainError(t('upload.ghNoWrite', { repo }))
}

interface GhRelease {
  id?: unknown
  upload_url?: unknown
  assets?: unknown
}

async function deleteGhAsset(a: { token: string; repo: string; signal: AbortSignal; fetchImpl: typeof fetch }, id: unknown, name: string): Promise<void> {
  if (typeof id !== 'number') throw new PlainError(t('upload.ghUnfinishedNoId', { name }))
  const res = await send('GitHub', a.fetchImpl, `${GH_API}/repos/${a.repo}/releases/assets/${id}`, { method: 'DELETE', headers: ghHeaders(a.token) }, a.signal, CHECK_TIMEOUT_MS)
  if (!res.ok) {
    const answer = await rejected('GitHub', res, a.token)
    throw new PlainError(t('upload.ghRemoveFailed', { name, answer: answer.message }))
  }
}

/**
 * A release already holding this zip is left alone, so a re-run sends only what is missing. An asset of
 * that name cut short by a cancel or a dropped connection still takes the name, so it is removed first.
 */
export async function uploadGitHub(a: {
  token: string
  repo: string
  folder: string
  version: string
  zip: string
  notes: string
  signal: AbortSignal
  fetchImpl: typeof fetch
  onProgress?: UploadProgress
}): Promise<{ link: string; alreadyThere: boolean }> {
  checkRepoName(a.repo)
  const { tag, asset: name, link } = ghRelease(a.repo, a.folder, a.version)
  const headers = ghHeaders(a.token)

  let res = await send('GitHub', a.fetchImpl, `${GH_API}/repos/${a.repo}/releases/tags/${tag}`, { headers }, a.signal, CHECK_TIMEOUT_MS)
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
      a.signal,
      CHECK_TIMEOUT_MS
    )
  }
  if (!res.ok) throw await rejected('GitHub', res, a.token)
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    parsed = null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PlainError(t('upload.badAnswer'))
  }
  const release = parsed as GhRelease
  const assets: unknown[] = Array.isArray(release.assets) ? release.assets : []
  const existing = assets.find((x) => typeof x === 'object' && x !== null && (x as { name?: unknown }).name === name) as { id?: unknown; state?: unknown } | undefined
  if (existing?.state === 'uploaded') return { link, alreadyThere: true }
  if (existing) await deleteGhAsset(a, existing.id, name)

  const fromUrl = typeof release.upload_url === 'string' ? /\/releases\/(\d+)\/assets/.exec(release.upload_url)?.[1] : undefined
  const id = fromUrl ?? (typeof release.id === 'number' ? String(release.id) : undefined)
  if (!id) throw new PlainError(t('upload.noReleaseId'))

  const size = await zipSize(a.zip)
  const stream = createReadStream(a.zip)
  const up = await send(
    'GitHub',
    a.fetchImpl,
    `${GH_UPLOADS}/repos/${a.repo}/releases/${id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/zip', 'Content-Length': String(size) },
      // Streamed from disk, since the biggest pack of a language would not fit in memory on every machine.
      body: Readable.toWeb(Readable.from(counted(stream, size, a.onProgress))) as unknown as BodyInit,
      duplex: 'half',
      redirect: 'error'
    } as RequestInit,
    a.signal
  ).finally(() => stream.destroy())
  if (!up.ok) throw await rejected('GitHub', up, a.token)
  return { link, alreadyThere: false }
}

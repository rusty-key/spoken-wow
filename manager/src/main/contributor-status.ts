import type { RowState, StoreId } from '../shared/types'
import { compareVersions } from '../shared/version'
import type { UploadRecord } from './contributor-store'
import { GH_API, ghHeaders, ghRelease } from './contributor-upload'
import { withTimeout } from './errors'

const TIMEOUT_MS = 10_000

/**
 * Only the trailing `-<version>.zip` counts: older language files carry a retired folder name before
 * it, so matching the whole name would call them unreleased.
 */
export function versionOfFileName(name: string): string | null {
  const m = /-(\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)\.zip$/.exec(name)
  return m ? m[1]! : null
}

/**
 * The versions CurseForge lists publicly; null when it could not be read. cfwidget's 404 is an answer: a
 * new project has nothing public yet, and an id that is wrong fails at upload, where nothing is sent twice.
 */
export async function cfPublicVersions(project: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`https://api.cfwidget.com/${encodeURIComponent(project)}`, {
      signal: withTimeout(TIMEOUT_MS, signal)
    })
    if (res.status === 404) return []
    if (res.status !== 200) return null
    const body = (await res.json()) as { files?: unknown }
    if (!Array.isArray(body.files)) return null
    const out: string[] = []
    for (const f of body.files) {
      const name = (f as { name?: unknown } | null)?.name
      const v = typeof name === 'string' ? versionOfFileName(name) : null
      if (v) out.push(v)
    }
    return out
  } catch {
    return null
  }
}

/**
 * Live means the tag exists and holds the whole zip. A release with no asset, or with one cut short
 * (GitHub lists it in another state), is unreleased so a failed run resumes.
 */
export async function ghHasAsset(
  repo: string,
  token: string,
  folder: string,
  version: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<{ live: boolean; link: string } | null> {
  const { tag, asset, link } = ghRelease(repo, folder, version)
  try {
    const res = await fetchImpl(`${GH_API}/repos/${repo}/releases/tags/${tag}`, {
      headers: ghHeaders(token),
      // A redirect would carry the token to wherever it points.
      redirect: 'error',
      signal: withTimeout(TIMEOUT_MS, signal)
    })
    if (res.status === 404) return { live: false, link }
    if (res.status !== 200) return null
    const body = (await res.json()) as { assets?: unknown }
    const live =
      Array.isArray(body.assets) &&
      body.assets.some((a) => {
        const listed = a as { name?: unknown; state?: unknown } | null
        return listed?.name === asset && listed.state === 'uploaded'
      })
    return { live, link }
  } catch {
    return null
  }
}

export function deriveRow(input: {
  store: StoreId
  folder: string
  installedVersion?: string
  linked: boolean
  stale: boolean
  project?: string
  publicVersions: string[] | null
  uploads: UploadRecord[]
}): RowState {
  const { installedVersion: v } = input
  if (!v) return 'not-installed'
  if (input.linked) return 'linked'
  if (input.stale) return 'update-first'
  if (input.store === 'curseforge' && !input.project) return 'no-project'
  if (input.publicVersions?.some((p) => p === v || (compareVersions(p, v) ?? -1) >= 0)) return 'live'
  if (input.uploads.some((u) => u.store === input.store && u.folder === input.folder && u.version === v)) {
    return 'awaiting'
  }
  return input.publicVersions === null ? 'unchecked' : 'unreleased'
}

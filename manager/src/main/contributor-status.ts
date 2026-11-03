import type { RowState } from '../shared/types'
import { compareVersions } from '../shared/version'
import type { StoreId, UploadRecord } from './contributor-store'
import { withTimeout } from './errors'

const PACKS = [
  'SpokenQuestsAudioAlliance',
  'SpokenQuestsAudioHorde',
  'SpokenQuestsAudioShared',
  'SpokenQuestsAudioGossip',
  'SpokenPlacesAudio',
  'SpokenReadablesAudio',
  'SpokenBossesAudio'
]

const TIMEOUT_MS = 10_000

/** The folders a language's release covers: English folders carry no suffix. */
export function languageFolders(lang: string): string[] {
  return PACKS.map((p) => (lang === 'enUS' ? p : `${p}_${lang}`))
}

/**
 * Only the trailing `-<version>.zip` counts: older language files carry a retired folder name before
 * it, so matching the whole name would call them unreleased.
 */
export function versionOfFileName(name: string): string | null {
  const m = /-(\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)\.zip$/.exec(name)
  return m ? m[1]! : null
}

/** The versions CurseForge lists publicly; null when it could not be read. */
export async function cfPublicVersions(project: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<string[] | null> {
  try {
    const res = await fetchImpl(`https://api.cfwidget.com/${encodeURIComponent(project)}`, {
      signal: withTimeout(TIMEOUT_MS, signal)
    })
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

/** Live means the tag exists and holds the zip; a release with no asset is unreleased so a failed run resumes. */
export async function ghHasAsset(
  repo: string,
  token: string,
  folder: string,
  version: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<{ live: boolean; link: string } | null> {
  const tag = `${folder}/v${version}`
  const link = `https://github.com/${repo}/releases/tag/${tag}`
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      // A redirect would carry the token to wherever it points.
      redirect: 'error',
      signal: withTimeout(TIMEOUT_MS, signal)
    })
    if (res.status === 404) return { live: false, link }
    if (res.status !== 200) return null
    const body = (await res.json()) as { assets?: unknown }
    const name = `${folder}-${version}.zip`
    const live = Array.isArray(body.assets) && body.assets.some((a) => (a as { name?: unknown } | null)?.name === name)
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

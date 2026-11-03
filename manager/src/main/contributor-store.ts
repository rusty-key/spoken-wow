// Secrets are written only through the SecretBox (Electron's safeStorage) and never returned by config().
import path from 'node:path'
import { PlainError } from './errors'
import type { ContributorConfig, StoreId } from '../shared/types'
import { readJsonFile, writeJsonAtomic } from './state'


/** `available` and `seal` can raise the macOS Keychain dialog, so nothing someone signed out triggers may call them. */
export interface SecretBox {
  available(): boolean
  seal(s: string): string
  open(s: string): string
}

export interface UploadRecord {
  store: StoreId
  folder: string
  version: string
  fileId: string | null
  at: string
}

export const DEFAULT_GAME_VERSIONS = '1.15.9 2.5.6 1.60.1'

interface ContributorFile {
  projects: Record<string, string>
  repo: string
  gameVersions: string
  tokens: Partial<Record<StoreId, string>>
  cookie: string | null
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const DIGITS = /^\d+$/
const CANNOT_KEEP = 'Spoken Manager cannot keep secrets on this computer right now. If your system asked for access, allow it and try again.'

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/** One pack on another's public project would reach the wrong players, and the other pack would read Live unsent. */
function refuseSharedProjects(projects: Record<string, string>): void {
  const holder = new Map<string, string>()
  for (const [folder, id] of Object.entries(projects)) {
    const other = holder.get(id)
    if (other) throw new PlainError(`${other} and ${folder} have the same CurseForge project id, ${id}. Each pack needs its own project.`)
    holder.set(id, folder)
  }
}

export class ContributorStore {
  private readonly file: string
  private readonly uploadsFile: string

  constructor(
    dataPath: string,
    private readonly box: SecretBox
  ) {
    this.file = path.join(dataPath, 'contributor.json')
    this.uploadsFile = path.join(dataPath, 'contributor-uploads.json')
  }

  private load(): ContributorFile {
    const raw = readJsonFile<unknown>(this.file, {})
    const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    const projects: Record<string, string> = {}
    if (typeof r.projects === 'object' && r.projects !== null) {
      for (const [k, v] of Object.entries(r.projects as Record<string, unknown>)) {
        if (typeof v === 'string' && DIGITS.test(v)) projects[k] = v
      }
    }
    const tokens: Partial<Record<StoreId, string>> = {}
    const t = typeof r.tokens === 'object' && r.tokens !== null ? (r.tokens as Record<string, unknown>) : {}
    for (const id of ['curseforge', 'github'] as const) {
      const v = str(t[id])
      if (v) tokens[id] = v
    }
    return {
      projects,
      repo: typeof r.repo === 'string' ? r.repo : '',
      gameVersions: str(r.gameVersions) ?? DEFAULT_GAME_VERSIONS,
      tokens,
      cookie: str(r.cookie)
    }
  }

  requireBox(): void {
    if (!this.box.available()) throw new PlainError(CANNOT_KEEP)
    // A refused system dialog may pass the check above. Found only at the real seal, that is after the password has left.
    try {
      this.box.seal('probe')
    } catch {
      throw new PlainError(CANNOT_KEEP)
    }
  }

  private openSealed(sealed: string | null | undefined): string | null {
    if (!sealed) return null
    try {
      return this.box.open(sealed) || null
    } catch {
      return null
    }
  }

  config(): ContributorConfig {
    const f = this.load()
    return {
      projects: f.projects,
      repo: f.repo,
      gameVersions: f.gameVersions,
      hasCfToken: Boolean(f.tokens.curseforge),
      hasGhToken: Boolean(f.tokens.github)
    }
  }

  saveConfig(patch: { projects?: Record<string, string>; repo?: string; gameVersions?: string }): ContributorConfig {
    const f = this.load()
    if (patch.projects) {
      const next = { ...f.projects }
      for (const [lang, raw] of Object.entries(patch.projects)) {
        const id = raw.trim()
        if (id === '') delete next[lang]
        else if (DIGITS.test(id)) next[lang] = id
        else throw new PlainError(`The CurseForge project id for ${lang} must be digits only.`)
      }
      refuseSharedProjects(next)
      f.projects = next
    }
    if (patch.repo !== undefined) {
      const repo = patch.repo.trim()
      if (repo !== '' && !REPO.test(repo)) throw new PlainError('The GitHub repository must look like owner/repo.')
      f.repo = repo
    }
    if (patch.gameVersions !== undefined) {
      f.gameVersions = patch.gameVersions.trim().split(/\s+/).filter(Boolean).join(' ') || DEFAULT_GAME_VERSIONS
    }
    writeJsonAtomic(this.file, f)
    return this.config()
  }

  /** An empty token forgets the stored one. */
  setToken(store: StoreId, token: string): void {
    const value = token.trim()
    const f = this.load()
    if (value === '') delete f.tokens[store]
    else {
      this.requireBox()
      f.tokens[store] = this.box.seal(value)
    }
    writeJsonAtomic(this.file, f)
  }

  token(store: StoreId): string | null {
    return this.openSealed(this.load().tokens[store])
  }

  setCookie(cookie: string | null): void {
    const value = cookie?.trim() ?? ''
    const f = this.load()
    if (value === '') f.cookie = null
    else {
      this.requireBox()
      f.cookie = this.box.seal(value)
    }
    writeJsonAtomic(this.file, f)
  }

  cookie(): string | null {
    return this.openSealed(this.load().cookie)
  }

  private allUploads(): UploadRecord[] {
    const raw = readJsonFile<unknown>(this.uploadsFile, [])
    return Array.isArray(raw) ? (raw as UploadRecord[]) : []
  }

  uploads(store: StoreId): UploadRecord[] {
    return this.allUploads().filter((r) => r.store === store)
  }

  recordUpload(r: UploadRecord): void {
    writeJsonAtomic(this.uploadsFile, [...this.allUploads(), r])
  }
}

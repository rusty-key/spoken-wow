// Which of a manifest's files an installed folder already holds, and so which to download.
import fs from 'node:fs'
import path from 'node:path'
import type { ChannelFile, ChannelManifest } from './packs-remote'
import type { PackState } from './packs-state'

export interface LocalFile {
  size: number
  mtimeMs: number
}

/** Every regular file under `dir` by its `/` path; links and other entries are skipped. Empty when `dir` is missing. */
export async function listLocal(dir: string): Promise<Map<string, LocalFile>> {
  const out = new Map<string, LocalFile>()
  const walk = async (rel: string): Promise<void> => {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) {
        const st = await fs.promises.stat(path.join(dir, p))
        out.set(p, { size: st.size, mtimeMs: st.mtimeMs })
      }
    }
  }
  await walk('')
  return out
}

/** Bytes to download: one clip used at two paths is counted once. */
function sizeOf(fetch: ChannelFile[]): { bytes: number; files: number } {
  const blobs = new Map<string, number>()
  for (const f of fetch) blobs.set(f.sha256, f.size)
  return { bytes: [...blobs.values()].reduce((a, b) => a + b, 0), files: fetch.length }
}

/**
 * The files to download. A file whose size and mtime are what the state recorded is trusted to hold the recorded hash.
 * Any other file of the right size is hashed: all of them for a folder with no state (installed by
 * another client) and for a repair (`trustState` false).
 */
export async function planPack(
  manifest: ChannelManifest,
  state: PackState | null,
  local: Map<string, LocalFile>,
  hash: (relPath: string) => Promise<string>,
  trustState = true
): Promise<ChannelFile[]> {
  const fetch: ChannelFile[] = []
  for (const f of manifest.files) {
    const l = local.get(f.path)
    if (!l || l.size !== f.size) {
      fetch.push(f)
      continue
    }
    const s = trustState ? state?.files[f.path] : undefined
    const sha = s && s.size === l.size && s.mtimeMs === l.mtimeMs ? s.sha256 : await hash(f.path)
    if (sha !== f.sha256) fetch.push(f)
  }
  return fetch
}

/** What an update would download, judged from the state alone, for the Update button's label. */
export function estimatePack(manifest: ChannelManifest, state: PackState | null): { bytes: number; files: number } {
  return sizeOf(manifest.files.filter((f) => state?.files[f.path]?.sha256 !== f.sha256))
}

// Housekeeping: leftovers of a crashed install, and the downloads the player asks to clear.
import fs from 'node:fs'
import path from 'node:path'
import type { GameInstall } from '../shared/types'
import type { ClearDownloadsResult } from '../shared/api'
import { isLinked } from './guard'
import { workDir } from './install'
import { log } from './state'

const STALE_PART_MS = 7 * 24 * 60 * 60 * 1000

/** Under the data folder: where a publish run zips each pack. */
export const CONTRIBUTOR_TMP = 'contributor-tmp'

/**
 * Run at start, with no job running and after interrupted swaps were undone: empties each game's
 * `.spoken-manager\staging` (an install that died half way leaves its extracted files there) and half-finished downloads that nobody
 * resumed for a week. A recent `.part` stays, because it is what makes a resume possible.
 */
export async function cleanLeftovers(games: GameInstall[], downloadsPath: string, now = Date.now()): Promise<void> {
  for (const game of games) {
    const work = workDir(game)
    const staging = path.join(work, 'staging')
    try {
      if ((await isLinked(work)) || (await isLinked(staging))) continue
      // Everything an install left behind, but not the swap journal of a change that could not be undone.
      for (const name of await fs.promises.readdir(staging)) {
        if (name !== 'journal.json') await fs.promises.rm(path.join(staging, name), { recursive: true, force: true })
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`Could not clean ${staging}:`, err)
    }
    // Blobs a sync downloaded but never used (it was cancelled and not retried) go after a week, as .part downloads do.
    const blobs = path.join(work, 'blobs')
    try {
      if (!(await isLinked(blobs))) {
        for (const name of await fs.promises.readdir(blobs)) {
          const file = path.join(blobs, name)
          const st = await fs.promises.lstat(file)
          if (st.isFile() && now - st.mtimeMs > STALE_PART_MS) await fs.promises.rm(file, { force: true })
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`Could not clean ${blobs}:`, err)
    }
  }
  try {
    const all = await fs.promises.readdir(downloadsPath)
    for (const name of all) {
      // A record with no .part beside it is nothing to resume.
      if (name.endsWith('.zip.part.meta') && !all.includes(name.slice(0, -'.meta'.length))) {
        await fs.promises.rm(path.join(downloadsPath, name), { force: true })
      }
      if (!name.endsWith('.zip.part')) continue
      const file = path.join(downloadsPath, name)
      const st = await fs.promises.lstat(file)
      if (st.isFile() && now - st.mtimeMs > STALE_PART_MS) {
        await fs.promises.rm(file, { force: true })
        await fs.promises.rm(`${file}.meta`, { force: true })
        log(`Removed an old half-finished download: ${name}`)
      }
    }
  } catch {
    /* no downloads folder yet */
  }
}

/** Run at start, with no job running: a quit during a publish leaves its temp zip behind. */
export async function cleanContributorTmp(dataPath: string): Promise<void> {
  const tmp = path.join(dataPath, CONTRIBUTOR_TMP)
  try {
    await fs.promises.rm(tmp, { recursive: true, force: true })
  } catch (err) {
    log(`Could not clean ${tmp}:`, err)
  }
}

/** Deletes the zips and half-finished zips in the downloads folder, and nothing else. */
export async function clearDownloads(downloadsPath: string): Promise<ClearDownloadsResult> {
  const result: ClearDownloadsResult = { files: 0, bytes: 0 }
  let names: string[]
  try {
    names = await fs.promises.readdir(downloadsPath)
  } catch {
    return result
  }
  for (const name of names) {
    if (!/\.zip(\.part(\.meta)?)?$/.test(name)) continue
    const file = path.join(downloadsPath, name)
    try {
      const st = await fs.promises.lstat(file)
      if (!st.isFile()) continue
      await fs.promises.rm(file, { force: true })
      if (!name.endsWith('.meta')) result.files++
      result.bytes += st.size
    } catch (err) {
      log(`Could not delete ${file}:`, err)
    }
  }
  log(`Cleared downloads: ${result.files} files, ${result.bytes} bytes.`)
  return result
}

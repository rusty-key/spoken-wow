// Installs, updates and repairs voice packs from the manager channel: download the blobs an
// installed folder lacks, build the new folder in staging from hard links (the unchanged files of
// the installed folder and the new blobs), and swap it in with install.ts's journaled folder swap.
// Spec: docs/superpowers/specs/2026-10-18-manager-delta-packs-design.md
import fs from 'node:fs'
import path from 'node:path'
import { channelTag } from '../shared/channel'
import type { GameInstall, JobPhase, Product } from '../shared/types'
import { downloadAsset, sha256OfFile } from './download'
import { PlainError, formatBytes, isAbortError, throwIfAborted } from './errors'
import { ensureFreeSpace, isGameRunning, isLinked, linkedMessage } from './guard'
import { applyChanges, backupDirFor, checkWritable, defaultOps, doneMessage, pruneBackups, refuseUnresolved, staleFolders, staleNote, workDir, type FsOps, type JobContext, type JobResult } from './install'
import { newestRev } from './packs-catalog'
import { listLocal, planPack } from './packs-plan'
import type { ChannelFile, ChannelManifest } from './packs-remote'
import { savePackState, loadPackState, type PackFileState } from './packs-state'
import { log, setRecord, updateState } from './state'
import { t } from './i18n'

export interface SyncInput {
  product: Product
  /** One per folder of the product, in the product's folder order. */
  manifests: ChannelManifest[]
  /** The channel's base URL, ending in `/`. */
  baseUrl: string
  /** Hash every file, whatever the state says. */
  repair?: boolean
  /** Replaces `fs.promises.link` (tests). */
  link?: (from: string, to: string) => Promise<void>
}

const PARALLEL = 12
const STAGE_PARALLEL = 16
const MARGIN = 64 * 1024 * 1024

export function blobDir(game: GameInstall): string {
  return path.join(workDir(game), 'blobs')
}

const segments = (p: string): string[] => p.split('/')

/**
 * Runs `fn` over `items`, `limit` at a time. The first failure calls `onFail` and stops new work; every
 * running worker is waited for before the first error is thrown, so nothing runs on after this returns.
 */
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>, onFail: () => void): Promise<void> {
  let next = 0
  let failure: { err: unknown } | null = null
  const worker = async (): Promise<void> => {
    while (!failure && next < items.length) {
      const item = items[next++]!
      try {
        await fn(item)
      } catch (err) {
        if (!failure) {
          failure = { err }
          onFail()
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (failure) throw (failure as { err: unknown }).err
}

export async function syncPacks(game: GameInstall, input: SyncInput, ctx: JobContext): Promise<JobResult> {
  const { product, manifests } = input
  const ops: FsOps = { ...defaultOps, ...ctx.ops }
  const link = input.link ?? ((from: string, to: string) => fs.promises.link(from, to))
  const revs = manifests.map((m) => m.rev)
  const shown = revs.length > 0 ? newestRev(revs) : ''
  const emit = (phase: JobPhase, received: number, total: number, bytesPerSecond = 0, message?: string): void =>
    ctx.emit({ jobId: ctx.jobId, gameId: game.id, productId: product.id, action: input.repair ? 'repair' : 'install', phase, received, total, bytesPerSecond, version: shown, ...(message ? { message } : {}) })

  throwIfAborted(ctx.signal)
  await checkWritable(game)
  await refuseUnresolved(game, ops)

  const folders = manifests.map((m) => m.packId)
  // Every folder is planned before anything is downloaded.
  emit('verifying', 0, 0, 0, 'Checking your files')
  const plans: { manifest: ChannelManifest; plan: ChannelFile[]; target: string }[] = []
  for (const manifest of manifests) {
    const target = path.join(game.addOnsPath, manifest.packId)
    if (await isLinked(target)) throw new PlainError(`${manifest.packId}: ${linkedMessage()}`)
    const plan = await planPack(manifest, loadPackState(game, manifest.packId), await listLocal(target), (p) => sha256OfFile(path.join(target, ...segments(p)), ctx.signal), !input.repair)
    plans.push({ manifest, plan, target })
  }

  const blobs = blobDir(game)
  await fs.promises.mkdir(blobs, { recursive: true })
  const wanted = new Map<string, number>()
  for (const { plan } of plans) for (const f of plan) wanted.set(f.sha256, f.size)
  // A blob kept from an interrupted job is whole: it was renamed into place only after its hash checked out.
  const missing: [string, number][] = []
  for (const [sha, size] of wanted) {
    const file = path.join(blobs, sha)
    const have = await fs.promises.stat(file).then((st) => st.size, () => -1)
    // Size alone is not proof: a rename that was never flushed can leave the right size with the wrong bytes.
    if (have === size && (await sha256OfFile(file, ctx.signal).catch((err: unknown) => {
      if (isAbortError(err)) throw err
      return ''
    })) === sha) continue
    if (have >= 0) await fs.promises.rm(file, { force: true })
    missing.push([sha, size])
  }
  const total = missing.reduce((n, [, size]) => n + size, 0)
  await ensureFreeSpace(game.addOnsPath, total + MARGIN, `${product.title} (${formatBytes(total)})`)

  let received = 0
  let lastSent = 0
  const started = Date.now()
  emit('downloading', 0, total)
  // The workers run under their own signal, so a failed blob stops the others before the job reports its error.
  const stop = new AbortController()
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, stop.signal]) : stop.signal
  await eachLimit(
    missing,
    PARALLEL,
    async ([sha, size]) => {
      // Progress comes per blob as bytes so far, which drops back when an attempt starts again.
      let mine = 0
      await downloadAsset({
        url: `${input.baseUrl}blobs/${sha}`,
        dir: blobs,
        baseName: sha,
        ext: '',
        source: 'the voice pack server',
        expectedSize: size,
        digest: `sha256:${sha}`,
        signal,
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
        ...(ctx.attempts ? { attempts: ctx.attempts } : {}),
        ...(ctx.backoffMs !== undefined ? { backoffMs: ctx.backoffMs } : {}),
        onProgress: (got) => {
          if (signal.aborted) return
          received += got - mine
          mine = got
          const now = Date.now()
          if (now - lastSent > 100) {
            lastSent = now
            emit('downloading', received, total, received / Math.max(1, (now - started) / 1000))
          }
        }
      }).catch((err: unknown) => {
        received -= mine
        if (!isAbortError(err)) log(`Blob ${sha} failed:`, err)
        throw err
      })
    },
    () => stop.abort()
  )

  const stagingJob = path.join(workDir(game), 'staging', ctx.jobId.replace(/[^\w.-]/g, '_'))
  try {
    emit('extracting', total, total)
    await fs.promises.rm(stagingJob, { recursive: true, force: true })
    for (const { manifest, plan, target } of plans) {
      const staged = path.join(stagingJob, manifest.packId)
      await fs.promises.mkdir(staged, { recursive: true })
      const fetched = new Set(plan.map((f) => f.path))
      const made = new Map<string, Promise<unknown>>()
      await eachLimit(
        manifest.files,
        STAGE_PARALLEL,
        async (f) => {
          throwIfAborted(ctx.signal)
          const from = fetched.has(f.path) ? path.join(blobs, f.sha256) : path.join(target, ...segments(f.path))
          const to = path.join(staged, ...segments(f.path))
          const dir = path.dirname(to)
          if (!made.has(dir)) made.set(dir, fs.promises.mkdir(dir, { recursive: true }))
          await made.get(dir)
          try {
            await link(from, to)
          } catch {
            await fs.promises.copyFile(from, to)
          }
        },
        () => undefined
      )
    }

    // Folders an earlier install of this product recorded (a GitHub zip's other names) go to the backup with the swap.
    const stale = await staleFolders(game, product, ctx.dataPath, folders)
    emit('installing', total, total)
    const { created } = await applyChanges(
      game,
      product.id,
      [...plans.map(({ manifest }) => ({ folder: manifest.packId, staged: path.join(stagingJob, manifest.packId) })), ...stale.map((folder) => ({ folder }))],
      ops,
      ctx.signal
    )

    // The new folders are live: from here nothing fails the job. A file that cannot be read now is left out of
    // the state, and the next sync hashes it.
    for (const { manifest, target } of plans) {
      const files: Record<string, PackFileState> = {}
      await eachLimit(
        manifest.files,
        STAGE_PARALLEL,
        async (f) => {
          try {
            const st = await fs.promises.stat(path.join(target, ...segments(f.path)))
            files[f.path] = { sha256: f.sha256, size: st.size, mtimeMs: st.mtimeMs }
          } catch (err) {
            log(`Could not record ${manifest.packId}/${f.path}:`, err)
          }
        },
        () => undefined
      )
      try {
        savePackState(game, { packId: manifest.packId, rev: manifest.rev, files })
      } catch (err) {
        log(`Could not save the state of ${manifest.packId}:`, err)
      }
    }
    updateState(ctx.dataPath, (s) => setRecord(s, game.id, product.id, { version: shown, folders, installedAt: new Date().toISOString(), tag: channelTag(revs) }))
    for (const sha of wanted.keys()) await fs.promises.rm(path.join(blobs, sha), { force: true }).catch(() => undefined)
    log(`Synced ${product.id} on ${game.label}: ${wanted.size} files fetched (${formatBytes(total)}), revs ${revs.join(', ')}.`)
    if (stale.length > 0) log(`Moved old folders of ${product.id} to the backup: ${stale.join(', ')}.`)

    const running = await (ctx.isRunning ?? (() => isGameRunning(game.flavor)))()
    // A channel pack can always be fetched again, and the kept backup shares hard links with the live files, which a
    // playing game can hold open on Windows. Removing it now leaves the next run nothing to delete; a failure is fine.
    await ops.rm(backupDirFor(game, product.id)).catch(() => undefined)
    await pruneBackups(game, product.id)
    const message = (input.repair ? 'Repaired. ' : '') + staleNote(stale) + doneMessage(running, created.length > 0, false)
    emit('done', total, total, 0, message)
    return { version: shown, folders, removed: stale, gameRunning: running, message }
  } finally {
    await fs.promises.rm(stagingJob, { recursive: true, force: true }).catch(() => undefined)
    await fs.promises.rmdir(path.join(workDir(game), 'staging')).catch(() => undefined)
  }
}

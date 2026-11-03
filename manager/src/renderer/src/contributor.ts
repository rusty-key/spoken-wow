// What the Contributor section decides without drawing: which tabs show, what a row offers, which job is a store's.
import type { ContributorConfig, ContributorView, JobProgress, PublishResult, ReleaseRow, StoreId } from '@shared/types'
import { storeConfigured } from '@shared/types'
import { S } from './strings'

export const STORES: StoreId[] = ['curseforge', 'github']

/** Nothing for a signed-out or non-admin account; Release only once a store could take a pack. */
export function visibleTabs(view: ContributorView, config: ContributorConfig): ('stores' | 'release')[] {
  if (!view.account || view.account.adminLangs.length === 0) return []
  return STORES.some((s) => storeConfigured(s, config)) ? ['stores', 'release'] : ['stores']
}

/** What Release would publish: the unreleased rows, and only those. */
export function releasableCount(rows: ReleaseRow[]): number {
  return rows.filter((r) => r.state === 'unreleased').length
}

/** The "Upload again" rows: ones a store may or may not hold. */
export function canUploadAgain(row: ReleaseRow): boolean {
  return row.state === 'awaiting' || row.state === 'unchecked'
}

const running = (j: JobProgress): boolean => j.phase !== 'done' && j.phase !== 'error' && j.phase !== 'cancelled'

/** The publish job of a store in any game, since the service runs one per store; a running job wins over a finished one. */
export function publishJobFor(jobs: Record<string, JobProgress>, store: StoreId): JobProgress | undefined {
  const mine = Object.values(jobs).filter((j) => j.action === 'publish' && j.productId === `publish/${store}`)
  return mine.find(running) ?? mine[0]
}

export const isRunning = (job: JobProgress | undefined): boolean => !!job && running(job)

/** The outcome in reading order: published, then skipped, then failed. */
export type ResultLine = { kind: 'published'; folder: string; version: string; link: string } | { kind: 'skipped'; folder: string } | { kind: 'failed'; folder: string; reason: string }

export function resultLines(r: PublishResult): ResultLine[] {
  return [
    ...r.published.map((p) => ({ kind: 'published' as const, ...p })),
    ...r.skipped.map((folder) => ({ kind: 'skipped' as const, folder })),
    ...r.failed.map((f) => ({ kind: 'failed' as const, ...f }))
  ]
}

export const storeName = (store: StoreId): string => (store === 'curseforge' ? S.contributor.curseforge : S.contributor.github)

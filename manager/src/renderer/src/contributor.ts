// What the Contributor section decides without drawing: which tabs show, what a row offers, which job is a store's.
import type { StoreInput } from '@shared/api'
import type { ContributorConfig, ContributorView, JobProgress, PublishResult, ReleaseRow, SkipReason, StoreId } from '@shared/types'
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

/** What a store form saves. A cleared project id goes as `''`: the saved ids are merged with these, and only that removes one. */
export function storeFormInput(store: StoreId, form: { token: string; removeToken: boolean; projects: Record<string, string>; repo: string; versions: string }): StoreInput {
  const token = form.removeToken ? '' : form.token
  const sentToken = token !== '' || form.removeToken ? { token } : {}
  if (store === 'github') return { store, ...sentToken, repo: form.repo.trim() }
  return { store, ...sentToken, projects: Object.fromEntries(Object.entries(form.projects).map(([k, v]) => [k, v.trim()])), gameVersions: form.versions.trim() }
}

/** The line under a row, naming the row's own store where the words depend on it. */
export function rowHint(state: ReleaseRow['state'], store: StoreId): string {
  return state === 'unchecked' ? S.contributor.hintUnchecked(storeName(store)) : S.contributor.hint[state]
}

export function skipReasonText(reason: SkipReason): string {
  return reason === 'already-there' ? S.contributor.alreadyThere : S.contributor.state[reason]
}

/** A run's line while it goes; a job still queued has no count to show. */
export function liveRunText(job: JobProgress): string {
  if (job.message) return job.message
  return job.total > 0 ? `${S.contributor.progress(job.received, job.total)}, ${S.contributor.starting}…` : `${S.contributor.starting}…`
}

const running = (j: JobProgress): boolean => j.phase !== 'done' && j.phase !== 'error' && j.phase !== 'cancelled'

/** The publish job of a store in any game, since the service runs one per store; a running job wins over a finished one. */
export function publishJobFor(jobs: Record<string, JobProgress>, store: StoreId): JobProgress | undefined {
  const mine = Object.values(jobs).filter((j) => j.action === 'publish' && j.productId === `publish/${store}`)
  return mine.find(running) ?? mine[0]
}

export const isRunning = (job: JobProgress | undefined): boolean => !!job && running(job)

/** The outcome in reading order: published, then skipped, then failed. */
export type ResultLine = { kind: 'published'; folder: string; version: string; link: string } | { kind: 'skipped'; folder: string; reason: SkipReason } | { kind: 'failed'; folder: string; reason: string }

export function resultLines(r: PublishResult): ResultLine[] {
  return [
    ...r.published.map((p) => ({ kind: 'published' as const, ...p })),
    ...r.skipped.map((s) => ({ kind: 'skipped' as const, ...s })),
    ...r.failed.map((f) => ({ kind: 'failed' as const, ...f }))
  ]
}

export const storeName = (store: StoreId): string => (store === 'curseforge' ? S.contributor.curseforge : S.contributor.github)

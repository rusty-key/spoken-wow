// What the Contributor section and the Release page decide without drawing: whether Release shows, what a row offers, which job is a store's.
import type { StoreInput } from '@shared/api'
import type { ContributorView, JobProgress, PublishResult, ReleaseRow, SkipReason, StoreId } from '@shared/types'
import { storeConfigured } from '@shared/types'
import { S } from './strings'

export const STORES: StoreId[] = ['curseforge', 'github']

/** Release shows to an admin once a store could take a pack. */
export function releaseAvailable(view: ContributorView | null): boolean {
  if (!view?.account || view.account.adminLangs.length === 0) return false
  return STORES.some((s) => storeConfigured(s, view.config))
}

/** A session that ends without the user asking is an expiry; an outage is not, and the notice lasts until an answer clears it. */
export function sessionExpired(was: { view: ContributorView | null; expired: boolean }, next: ContributorView, asked: boolean): boolean {
  if (next.account || asked) return false
  return was.expired || (!!was.view?.account && !next.siteUnreachable)
}

/** What Release would publish: the unreleased rows, and only those. */
export function releasableCount(rows: ReleaseRow[]): number {
  return rows.filter((r) => r.state === 'unreleased').length
}

/** A row's own button: a pack not sent yet, or one a store may or may not hold. Others offer nothing. */
export function rowUploadLabel(row: ReleaseRow): string | null {
  if (row.state === 'unreleased') return S.contributor.upload
  return row.state === 'awaiting' || row.state === 'unchecked' ? S.contributor.uploadAgain : null
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

/** A run's line while it goes; a job still queued has no step to name. */
export function liveRunText(job: JobProgress): string {
  return job.message ?? `${S.contributor.starting}…`
}

/** How much of the pack has gone, or null while a step has no bytes to count. */
export function runPercent(job: JobProgress): number | null {
  return job.total > 0 ? Math.min(100, Math.floor((job.received / job.total) * 100)) : null
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

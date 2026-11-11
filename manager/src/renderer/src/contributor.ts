import type { StoreInput } from '@shared/api'
import type { ContributorView, JobProgress, PublishResult, ReleaseRow, SkipReason, StoreId } from '@shared/types'
import { storeConfigured } from '@shared/types'
import { jobBusy } from './catalog'
import { S } from './strings'

export const STORES: StoreId[] = ['curseforge', 'github']

/** Release shows to an admin once a store could take a pack. */
export function releaseAvailable(view: ContributorView | null): boolean {
  if (!view?.account || view.account.adminLangs.length === 0) return false
  return STORES.some((s) => storeConfigured(s, view.config))
}

export function releasableCount(rows: ReleaseRow[]): number {
  return rows.filter((r) => r.state === 'unreleased').length
}

export function rowUploadLabel(row: ReleaseRow): string | null {
  if (row.state === 'unreleased') return S.contributor.upload
  return row.state === 'awaiting' || row.state === 'unchecked' ? S.contributor.uploadAgain : null
}

/** A cleared project id goes as `''`: the saved ids are merged with these, and only that removes one. */
export function storeFormInput(store: StoreId, form: { token: string; removeToken: boolean; projects: Record<string, string>; repo: string; versions: string }): StoreInput {
  // Trimmed here: only Remove Token may send an empty one, which forgets the saved token.
  const token = form.removeToken ? '' : form.token.trim()
  const sentToken = token !== '' || form.removeToken ? { token } : {}
  if (store === 'github') return { store, ...sentToken, repo: form.repo.trim() }
  return { store, ...sentToken, projects: Object.fromEntries(Object.entries(form.projects).map(([k, v]) => [k, v.trim()])), gameVersions: form.versions.trim() }
}

export function rowHint(state: ReleaseRow['state'], store: StoreId): string {
  return state === 'unchecked' ? S.contributor.hintUnchecked(storeName(store)) : S.contributor.hint[state]
}

export function skipReasonText(reason: SkipReason): string {
  return reason === 'already-there' ? S.contributor.alreadyThere : S.contributor.state[reason]
}

export function liveRunText(job: JobProgress): string {
  return job.message ?? `${S.contributor.starting}…`
}

/** Null while a step has no bytes to count. */
export function runPercent(job: JobProgress): number | null {
  return job.total > 0 ? Math.min(100, Math.floor((job.received / job.total) * 100)) : null
}

/** The publish job of a store in any game, since the service runs one per store; a running job wins over a finished one. */
export function publishJobFor(jobs: Record<string, JobProgress>, store: StoreId): JobProgress | undefined {
  const mine = Object.values(jobs).filter((j) => j.action === 'publish' && j.productId === `publish/${store}`)
  return mine.find(jobBusy) ?? mine[0]
}

/** The outcome in reading order: published, then skipped, then failed. */
type ResultLine = { kind: 'published'; folder: string; version: string; link: string } | { kind: 'skipped'; folder: string; reason: SkipReason } | { kind: 'failed'; folder: string; reason: string }

export function resultLines(r: PublishResult): ResultLine[] {
  return [
    ...r.published.map((p) => ({ kind: 'published' as const, ...p })),
    ...r.skipped.map((s) => ({ kind: 'skipped' as const, ...s })),
    ...r.failed.map((f) => ({ kind: 'failed' as const, ...f }))
  ]
}

/** CurseForge and GitHub are brand names, the same in every language. */
export const storeName = (store: StoreId): string => (store === 'curseforge' ? S.contributor.curseforge : S.contributor.github)

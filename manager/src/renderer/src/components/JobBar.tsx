import type { ReactNode } from 'react'
import type { JobProgress } from '@shared/types'
import { formatBytes, formatSpeed } from '../format'
import { S } from '../strings'

export function jobLabel(job: JobProgress): string {
  const pct = job.total > 0 ? Math.min(100, Math.floor((job.received / job.total) * 100)) : 0
  switch (job.phase) {
    case 'queued':
      return S.jobs.queued
    case 'downloading':
      return job.total > 0 ? S.jobs.downloading(pct) : S.jobs.downloadingUnknown
    case 'verifying':
      return S.jobs.verifying
    case 'extracting':
      return S.jobs.extracting
    case 'installing':
      return job.action === 'uninstall' ? S.jobs.removing : S.jobs.installing
    case 'done':
      return S.jobs.done
    case 'cancelled':
      return S.jobs.cancelled
    case 'error':
      return S.jobs.error
  }
}

interface Props {
  job: JobProgress
  size?: 'lg' | 'md' | 'sm'
  onCancel?: () => void
  /** Draw the speed line and the Cancel link under the bar. */
  meta?: boolean
}

/** The progress bar that takes the place of a button while a job runs. */
export function JobBar({ job, size = 'md', onCancel, meta = true }: Props): ReactNode {
  // A release has no download phases to label; the Contributor section draws its own progress.
  if (job.action === 'publish') return null
  const downloading = job.phase === 'downloading' && job.total > 0
  const pct = downloading ? Math.min(100, (job.received / job.total) * 100) : job.phase === 'queued' ? 0 : 100
  const indeterminate = job.phase !== 'downloading' || job.total <= 0
  const label = jobLabel(job)
  const canCancel = !!onCancel && job.phase !== 'installing' && job.phase !== 'verifying'
  return (
    <div className={`jobbar jobbar-${size}`} aria-busy="true">
      <div
        className={`jobbar-track${indeterminate && job.phase !== 'queued' ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={downloading ? Math.round(pct) : undefined}
      >
        <div className="jobbar-fill" style={{ width: `${pct}%` }} />
        <span className="jobbar-text">{label}</span>
      </div>
      {/* Read out when the phase changes, not on every percent. */}
      <span className="sr-only" aria-live="polite">
        {job.phase === 'downloading' ? S.jobs.downloadingUnknown : label}
      </span>
      {meta && (
        <div className="jobbar-meta">
          <span>
            {downloading
              ? `${formatSpeed(job.bytesPerSecond)} · ${formatBytes(job.received)} of ${formatBytes(job.total)}`
              : job.version
                ? `Version ${job.version}`
                : ''}
          </span>
          {canCancel && (
            <button type="button" className="link" onClick={onCancel}>
              {S.common.cancel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

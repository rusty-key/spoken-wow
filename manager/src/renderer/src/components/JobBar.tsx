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

/** A bar; with no percent it moves without saying how far along it is. */
export function ProgressTrack({ percent, label, text }: { percent: number | null; label: string; text?: string }): ReactNode {
  return (
    <div className={`jobbar-track${percent === null ? ' is-indeterminate' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === null ? undefined : Math.round(percent)}>
      <div className="jobbar-fill" style={{ width: `${percent ?? 100}%` }} />
      {text && <span className="jobbar-text">{text}</span>}
    </div>
  )
}

/** The progress bar that takes the place of a button while a job runs. */
export function JobBar({ job, size = 'md', onCancel, meta = true }: Props): ReactNode {
  const downloading = job.phase === 'downloading' && job.total > 0
  const percent = downloading ? Math.min(100, (job.received / job.total) * 100) : job.phase === 'queued' ? 0 : null
  const label = jobLabel(job)
  const canCancel = !!onCancel && job.phase !== 'installing' && job.phase !== 'verifying'
  return (
    <div className={`jobbar jobbar-${size}`} aria-busy="true">
      <ProgressTrack percent={percent} label={label} text={label} />
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

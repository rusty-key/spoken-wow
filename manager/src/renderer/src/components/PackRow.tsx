import { useState, type ReactNode } from 'react'
import { jobBusy, statusOf } from '../catalog'
import { jobKey, useStore } from '../store'
import { S } from '../strings'
import { IconAlert, IconCheck, IconLink, IconX } from './Icons'
import { JobBar } from './JobBar'

interface Props {
  gameId: string
  /** The product id: `quests-audio-deDE`, `community/elune-quests-deDE`. */
  productId: string
  writable: boolean
  /** Why nothing may be installed or removed here, besides a read-only folder. */
  blockedReason?: string | null
  /** False when there is nothing to install and nothing installed. */
  released: boolean
  title: ReactNode
  /** The first muted line under the title. */
  text: ReactNode
  /** More lines under it. */
  children?: ReactNode
}

/** One pack in a list: title, state badge, and Install / Update / Remove or the job's progress bar. */
export function PackRow({ gameId, productId, writable, blockedReason, released, title, text, children }: Props): ReactNode {
  const { state, actions } = useStore()
  const [confirm, setConfirm] = useState(false)
  const status = statusOf(state, gameId, productId)
  const job = state.jobs[jobKey(gameId, productId)]
  const busy = jobBusy(job)
  const s = status?.state ?? 'not-installed'
  const present = s !== 'not-installed'
  const reason = blockedReason ?? (writable ? null : S.common.readOnly)

  const badge =
    s === 'up-to-date' ? (
      <span className="badge badge-ok">
        <IconCheck size={13} />
        {S.voices.badge.installed}
      </span>
    ) : s === 'update-available' ? (
      <span className="badge badge-warn">
        <IconAlert size={13} />
        {S.voices.badge.update}
      </span>
    ) : s === 'linked' ? (
      <span className="badge badge-dev">
        <IconLink size={13} />
        {S.voices.badge.linked}
      </span>
    ) : s === 'ahead' ? (
      <span className="badge badge-ok">{S.voices.badge.ahead}</span>
    ) : s === 'unknown' ? (
      <span className="badge badge-muted">{S.voices.badge.unknown}</span>
    ) : null

  const label = (base: string): string => (status?.needsSpoken ? S.voices.withSpoken(base) : base)
  const install = (): void => void actions.install(gameId, productId)
  const repair = (): void => void actions.repair(gameId, productId)
  const retry = (): void => {
    if (job?.action === 'uninstall') void actions.uninstall(gameId, productId)
    else if (job?.action === 'repair') repair()
    else install()
  }
  // Installed by hand: a repair needs to know the version, an update puts the newest one over it.
  const canRepair = present && (s !== 'unknown' || !!status?.installedVersion)

  let action: ReactNode
  if (busy) {
    action = <JobBar job={job} size="sm" onCancel={() => actions.cancel(job.jobId)} />
  } else if (!released && !present) {
    action = <span className="muted">{S.common.notReleased}</span>
  } else if (confirm) {
    action = (
      <span className="inline-confirm">
        <span>{S.voices.confirmRemove}</span>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={() => {
            setConfirm(false)
            void actions.uninstall(gameId, productId)
          }}
        >
          {S.common.remove}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setConfirm(false)}>
          {S.common.keep}
        </button>
      </span>
    )
  } else if (s === 'linked') {
    action = null
  } else {
    action = (
      <span className="row-buttons">
        {s === 'not-installed' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!!reason} onClick={install}>
            {label(S.voices.install)}
          </button>
        )}
        {(s === 'update-available' || (s === 'unknown' && released)) && (
          <button type="button" className="btn btn-primary btn-sm" disabled={!!reason} onClick={install}>
            {label(S.voices.update)}
          </button>
        )}
        {canRepair && (
          <button type="button" className="btn btn-sm" disabled={!!reason} onClick={repair}>
            {S.common.repair}
          </button>
        )}
        {present && (
          <button type="button" className="btn btn-sm" disabled={!!reason} onClick={() => setConfirm(true)}>
            {S.common.remove}
          </button>
        )}
      </span>
    )
  }

  return (
    <li className="row pack-row">
      <div className="row-main">
        <span className="row-title">{title}</span>
        <span className="row-text">{text}</span>
        {children}
        {reason && !busy && s !== 'linked' && (
          <span className="row-note">
            <IconAlert size={14} />
            {reason}
          </span>
        )}
        {job?.phase === 'error' && (
          <span className="row-error" role="alert">
            <IconAlert size={14} />
            {job.message ?? S.jobs.error}
            <button type="button" className="link" onClick={retry}>
              {S.common.retry}
            </button>
            <button type="button" className="icon-btn icon-btn-sm" aria-label={S.common.dismiss} onClick={() => actions.dismissJob(jobKey(gameId, productId))}>
              <IconX size={13} />
            </button>
          </span>
        )}
      </div>
      {!busy && badge}
      <div className="row-action">{action}</div>
    </li>
  )
}

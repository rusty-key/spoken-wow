import { useEffect, useState, type ReactNode } from 'react'
import { languageName } from '@shared/products'
import type { ContributorView, JobProgress, PublishResult, ReleaseRow, RowState, StoreId } from '@shared/types'
import { storeConfigured } from '@shared/types'
import { api, errorText } from '../api'
import { jobBusy } from '../catalog'
import { IconExternal, IconRefresh } from '../components/Icons'
import { ProgressTrack } from '../components/JobBar'
import { STORES, liveRunText, publishJobFor, releasableCount, resultLines, rowHint, rowUploadLabel, runPercent, skipReasonText, storeName } from '../contributor'
import { formatBytes, formatSpeed } from '../format'
import { jobKey, useGame, useStore } from '../store'
import { S } from '../strings'

export function Release({ view, lang }: { view: ContributorView; lang: string }): ReactNode {
  const game = useGame()
  const { actions } = useStore()
  const stores = STORES.filter((s) => storeConfigured(s, view.config))

  if (!game) return <p className="settings-text">{S.contributor.noGame}</p>
  return (
    <div>
      {stores.map((s) => (
        <StoreRelease key={s} store={s} gameId={game.id} lang={lang} view={view} onDismiss={(job) => actions.dismissJob(jobKey(job.gameId, job.productId))} />
      ))}
    </div>
  )
}

function StoreRelease({ store, gameId, lang, view, onDismiss }: { store: StoreId; gameId: string; lang: string; view: ContributorView; onDismiss: (job: JobProgress) => void }): ReactNode {
  const { state, actions } = useStore()
  const job = publishJobFor(state.jobs, store)
  const running = jobBusy(job)
  const [rows, setRows] = useState<ReleaseRow[] | null>(null)
  const [rowsError, setRowsError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [starting, setStarting] = useState(false)
  const [refusal, setRefusal] = useState('')
  const lastRun = view.lastRuns[store] ?? null

  useEffect(() => {
    let alive = true
    setRowsError('')
    setRows(null)
    api()
      .contributorRows(gameId, lang, store)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && (setRows([]), setRowsError(errorText(e))))
    return () => {
      alive = false
    }
    // Every run ends with a new result, a cancelled one too, whose job is already gone.
  }, [gameId, lang, store, refresh, lastRun?.finishedAt])

  const publish = async (only?: string): Promise<void> => {
    setStarting(true)
    setRefusal('')
    if (job) onDismiss(job)
    try {
      await api().contributorPublish(gameId, lang, store, only)
    } catch (e) {
      setRefusal(errorText(e))
    } finally {
      setStarting(false)
    }
  }

  const busy = running || starting
  const count = rows ? releasableCount(rows) : 0
  const result = running ? null : lastRun
  return (
    <div className="contrib-store">
      <div className="settings-title-row">
        <h3 className="contrib-store-h">{storeName(store)}</h3>
        <button type="button" className="icon-btn" aria-label={S.contributor.refresh} title={S.contributor.refresh} disabled={busy} onClick={() => setRefresh((n) => n + 1)}>
          <IconRefresh size={16} />
        </button>
      </div>

      <div className="contrib-actions">
        <button type="button" className="btn btn-primary" disabled={busy || rows === null || count === 0} onClick={() => void publish()}>
          {S.contributor.release(count)}
        </button>
        {running && job && (
          <button type="button" className="btn" onClick={() => actions.cancel(job.jobId)}>
            {S.common.cancel}
          </button>
        )}
        {!busy && rows && count === 0 && <span className="muted">{S.contributor.nothingToRelease}</span>}
      </div>

      {(job || refusal) && (
        <div className="contrib-run">
          {job && <RunLine job={job} onDismiss={() => onDismiss(job)} />}
          {refusal && <p className="text-error" role="alert">{refusal}</p>}
        </div>
      )}

      {rowsError && <p className="text-error" role="alert">{rowsError}</p>}
      {rows === null ? (
        <p className="muted">{S.contributor.loading}…</p>
      ) : rows.length === 0 && !rowsError ? (
        <p className="muted">{S.contributor.noRows}</p>
      ) : (
        <ul className="list card contrib-rows">
          {rows.map((r) => (
            <RowItem key={r.folder} row={r} store={store} storeBusy={busy} onUpload={() => void publish(r.folder)} />
          ))}
        </ul>
      )}

      {result && <Result result={result} />}
    </div>
  )
}

const ROW_TONE: Partial<Record<RowState, string>> = { live: 'status-ok', unreleased: 'status-dev', awaiting: 'status-warn', unchecked: 'status-warn', 'update-first': 'status-warn' }
const RESULT_LOOK = {
  published: { tone: 'status-ok', label: S.contributor.published },
  skipped: { tone: '', label: S.contributor.skipped },
  failed: { tone: 'status-error', label: S.contributor.failed }
}

function RunLine({ job, onDismiss }: { job: JobProgress; onDismiss: () => void }): ReactNode {
  const live = jobBusy(job)
  const text = live
    ? liveRunText(job)
    : job.phase === 'done'
      ? S.contributor.runDone
      : job.phase === 'cancelled'
        ? S.contributor.runCancelled
        : (job.message ?? S.contributor.runFailed)
  const percent = runPercent(job)
  return (
    <>
      {live && (
        <div className="jobbar jobbar-sm" aria-busy="true">
          <ProgressTrack percent={percent} label={text} text={percent === null ? undefined : `${percent}%`} />
          {percent !== null && <div className="jobbar-meta">{S.contributor.sentOf(formatSpeed(job.bytesPerSecond), formatBytes(job.received), formatBytes(job.total))}</div>}
        </div>
      )}
      {/* Apart from the bar, so a reader hears each step and not each percent. */}
      <div className={`status ${job.phase === 'error' ? 'status-error' : ''}`} role="status">
        <span>{text}</span>
        {!live && (
          <button type="button" className="link link-muted" onClick={onDismiss}>
            {S.common.dismiss}
          </button>
        )}
      </div>
    </>
  )
}

function RowItem({ row, store, storeBusy, onUpload }: { row: ReleaseRow; store: StoreId; storeBusy: boolean; onUpload: () => void }): ReactNode {
  const uploadLabel = rowUploadLabel(row)
  return (
    <li className="contrib-row">
      <div className="contrib-row-main">
        <span className="contrib-folder" title={row.folder}>
          {row.folder}
        </span>
        <span className="muted contrib-version">{row.version ?? ''}</span>
        <span className={`status ${ROW_TONE[row.state] ?? ''}`}>{S.contributor.state[row.state]}</span>
        {row.link && (
          <button type="button" className="icon-btn icon-btn-sm" aria-label={row.folder} title={row.link} onClick={() => void api().openExternal(row.link!).catch(() => undefined)}>
            <IconExternal size={14} />
          </button>
        )}
        {uploadLabel && (
          <button type="button" className="btn btn-sm" disabled={storeBusy} aria-label={`${uploadLabel} ${row.folder}`} onClick={onUpload}>
            {uploadLabel}
          </button>
        )}
      </div>
      <span className="muted contrib-hint">{rowHint(row.state, store)}</span>
    </li>
  )
}

function Result({ result }: { result: PublishResult }): ReactNode {
  const lines = resultLines(result)
  return (
    <div className="contrib-result">
      <h4 className="field-label">{S.contributor.resultTitle(storeName(result.store), languageName(result.lang))}</h4>
      {result.stoppedEarly && <p className="status status-warn">{S.contributor.stoppedEarly}</p>}
      <ul>
        {lines.map((l) => (
          <li key={`${l.kind}-${l.folder}`} className="contrib-result-line">
            <span className={`status ${RESULT_LOOK[l.kind].tone}`}>{RESULT_LOOK[l.kind].label}</span>
            <span className="contrib-folder" title={l.folder}>
              {l.folder}
            </span>
            {l.kind === 'published' && (
              <>
                <span className="muted">{l.version}</span>
                <button type="button" className="link" onClick={() => void api().openExternal(l.link).catch(() => undefined)}>
                  {l.link}
                </button>
              </>
            )}
            {l.kind === 'skipped' && <span className="muted">{skipReasonText(l.reason)}</span>}
            {l.kind === 'failed' && <span className="text-error">{l.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

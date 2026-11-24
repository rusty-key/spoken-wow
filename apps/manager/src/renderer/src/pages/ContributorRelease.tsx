import { useEffect, useState, type ReactNode } from 'react'
import type { ContributorView, JobProgress, ManualZip, PublishResult, ReleaseRow, RowState, StoreId } from '@shared/types'
import { storeConfigured } from '@shared/types'
import { api, errorText } from '../api'
import { jobBusy } from '../catalog'
import { IconExternal, IconRefresh } from '../components/Icons'
import { ProgressTrack } from '../components/JobBar'
import { STORES, canZip, liveRunText, publishJobFor, releasableCount, resultLines, rowHint, rowUploadLabel, runPercent, skipReasonText, storeName } from '../contributor'
import { formatBytes, formatSpeed } from '../format'
import { jobKey, useGame, useLanguageName, useStore } from '../store'
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
            <RowItem key={r.folder} row={r} store={store} storeBusy={busy} gameId={gameId} lang={lang} onUpload={() => void publish(r.folder)} />
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

function RowItem({ row, store, storeBusy, gameId, lang, onUpload }: { row: ReleaseRow; store: StoreId; storeBusy: boolean; gameId: string; lang: string; onUpload: () => void }): ReactNode {
  const uploadLabel = rowUploadLabel(row)
  const { state } = useStore()
  const [zipping, setZipping] = useState(false)
  const [zip, setZip] = useState<ManualZip | null>(null)
  const [zipError, setZipError] = useState('')
  const makeZip = async (): Promise<void> => {
    setZipping(true)
    setZipError('')
    setZip(null)
    try {
      setZip(await api().contributorZip(gameId, lang, row.folder))
    } catch (e) {
      setZipError(errorText(e))
    } finally {
      setZipping(false)
    }
  }
  const zipHere = store === 'curseforge' && canZip(row)
  // A zip of an older version is not what the row now offers.
  const shownZip = zip && zip.version === row.version ? zip : null
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
        {zipHere && (
          <button type="button" className="btn btn-sm" disabled={zipping} title={S.contributor.zipTitle} aria-label={`${S.contributor.zip} ${row.folder}`} onClick={() => void makeZip()}>
            {zipping ? `${S.contributor.zipping}…` : S.contributor.zip}
          </button>
        )}
        {uploadLabel && (
          <button type="button" className="btn btn-sm" disabled={storeBusy} aria-label={`${uploadLabel} ${row.folder}`} onClick={onUpload}>
            {uploadLabel}
          </button>
        )}
      </div>
      <span className="muted contrib-hint">{rowHint(row.state, store)}</span>
      {shownZip && (
        <div className="contrib-zip" role="status">
          <span className="contrib-hint">{S.contributor.zipReady(shownZip.name, formatBytes(shownZip.bytes))}</span>
          <span className="contrib-zip-actions">
            <button type="button" className="link" onClick={() => void api().contributorRevealZip(shownZip.path).catch((e) => setZipError(errorText(e)))}>
              {S.common.showIn(state.platform)}
            </button>
            <button type="button" className="link" onClick={() => void api().openExternal(shownZip.uploadUrl).catch((e) => setZipError(errorText(e)))}>
              {S.contributor.openUploadPage}
            </button>
          </span>
        </div>
      )}
      {zipError && (
        <p className="text-error contrib-hint" role="alert">
          {zipError}
        </p>
      )}
    </li>
  )
}

function Result({ result }: { result: PublishResult }): ReactNode {
  const lines = resultLines(result)
  const languageName = useLanguageName()
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

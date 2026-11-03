import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ContributorView, JobProgress, PublishResult, ReleaseRow, StoreId } from '@shared/types'
import { storeConfigured } from '@shared/types'
import { api, errorText } from '../api'
import { IconExternal, IconRefresh } from '../components/Icons'
import { STORES, canUploadAgain, isRunning, publishJobFor, releasableCount, resultLines, storeName } from '../contributor'
import { jobKey, useGame, useStore } from '../store'
import { S } from '../strings'

export function Release({ view, lang }: { view: ContributorView; lang: string }): ReactNode {
  const game = useGame()
  const { state, actions } = useStore()
  const [reload, setReload] = useState(0)
  const stores = STORES.filter((s) => storeConfigured(s, view.config))

  // A finished run changes what the stores hold: ask for the rows and the result again.
  const finished = stores.map((s) => publishJobFor(state.jobs, s)).filter((j): j is JobProgress => !!j && !isRunning(j)).map((j) => j.jobId).join(',')
  useEffect(() => {
    if (finished !== '') setReload((n) => n + 1)
  }, [finished])

  if (!game) return <p className="settings-text">{S.contributor.noGame}</p>
  return (
    <div>
      {stores.map((s) => (
        <StoreRelease key={s} store={s} gameId={game.id} lang={lang} view={view} reload={reload} onDismiss={(job) => actions.dismissJob(jobKey(job.gameId, job.productId))} />
      ))}
    </div>
  )
}

function StoreRelease({ store, gameId, lang, view, reload, onDismiss }: { store: StoreId; gameId: string; lang: string; view: ContributorView; reload: number; onDismiss: (job: JobProgress) => void }): ReactNode {
  const { state, actions } = useStore()
  const job = publishJobFor(state.jobs, store)
  const running = isRunning(job)
  const [rows, setRows] = useState<ReleaseRow[] | null>(null)
  const [rowsError, setRowsError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [starting, setStarting] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [lastRun, setLastRun] = useState<PublishResult | null>(view.lastRun)

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
  }, [gameId, lang, store, reload, refresh])

  useEffect(() => {
    let alive = true
    if (reload > 0) api().contributorView().then((v) => alive && setLastRun(v.lastRun)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [reload])

  // A run that was cancelled still published some packs, and its job is gone: the new result is the cue.
  const seenRun = useRef(view.lastRun)
  useEffect(() => {
    setLastRun(view.lastRun)
    if (view.lastRun !== seenRun.current) setRefresh((n) => n + 1)
    seenRun.current = view.lastRun
  }, [view.lastRun])

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
  const result = lastRun?.store === store && !running ? lastRun : null
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
        <div className="contrib-run" role="status">
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
            <RowItem key={r.folder} row={r} storeBusy={busy} onUploadAgain={() => void publish(r.folder)} />
          ))}
        </ul>
      )}

      {result && <Result result={result} />}
    </div>
  )
}

function RunLine({ job, onDismiss }: { job: JobProgress; onDismiss: () => void }): ReactNode {
  const live = isRunning(job)
  const text = live
    ? (job.message ?? `${S.contributor.progress(job.received, job.total)}, ${S.contributor.starting}…`)
    : job.phase === 'done'
      ? S.contributor.runDone
      : job.phase === 'cancelled'
        ? S.contributor.runCancelled
        : (job.message ?? S.contributor.runFailed)
  return (
    <div className={`status ${job.phase === 'error' ? 'status-error' : ''}`}>
      <span>{text}</span>
      {!live && (
        <button type="button" className="link link-muted" onClick={onDismiss}>
          {S.common.dismiss}
        </button>
      )}
    </div>
  )
}

function RowItem({ row, storeBusy, onUploadAgain }: { row: ReleaseRow; storeBusy: boolean; onUploadAgain: () => void }): ReactNode {
  const tone = row.state === 'live' ? 'status-ok' : row.state === 'unreleased' ? 'status-dev' : row.state === 'awaiting' || row.state === 'unchecked' || row.state === 'update-first' ? 'status-warn' : ''
  return (
    <li className="contrib-row">
      <div className="contrib-row-main">
        <span className="contrib-folder" title={row.folder}>
          {row.folder}
        </span>
        <span className="muted contrib-version">{row.version ?? ''}</span>
        <span className={`status ${tone}`}>{S.contributor.state[row.state]}</span>
        {row.link && (
          <button type="button" className="icon-btn icon-btn-sm" aria-label={row.folder} title={row.link} onClick={() => void api().openExternal(row.link!).catch(() => undefined)}>
            <IconExternal size={14} />
          </button>
        )}
        {canUploadAgain(row) && (
          <button type="button" className="btn btn-sm" disabled={storeBusy} onClick={onUploadAgain}>
            {S.contributor.uploadAgain}
          </button>
        )}
      </div>
      <span className="muted contrib-hint">{S.contributor.hint[row.state]}</span>
    </li>
  )
}

function Result({ result }: { result: PublishResult }): ReactNode {
  const lines = resultLines(result)
  return (
    <div className="contrib-result">
      <h4 className="field-label">{S.contributor.resultTitle(storeName(result.store))}</h4>
      {result.stoppedEarly && <p className="status status-warn">{S.contributor.stoppedEarly}</p>}
      <ul>
        {lines.map((l) => (
          <li key={`${l.kind}-${l.folder}`} className="contrib-result-line">
            <span className={`status ${l.kind === 'published' ? 'status-ok' : l.kind === 'failed' ? 'status-error' : ''}`}>
              {l.kind === 'published' ? S.contributor.published : l.kind === 'skipped' ? S.contributor.skipped : S.contributor.failed}
            </span>
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
            {l.kind === 'failed' && <span className="text-error">{l.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

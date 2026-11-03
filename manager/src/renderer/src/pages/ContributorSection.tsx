import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { languageFolders, languageName } from '@shared/products'
import type { ContributorView, JobProgress, PublishResult, ReleaseRow, StoreId } from '@shared/types'
import { storeConfigured } from '@shared/types'
import { api, errorText } from '../api'
import { IconExternal, IconRefresh } from '../components/Icons'
import { Select } from '../components/Controls'
import { STORES, canUploadAgain, isRunning, publishJobFor, releasableCount, resultLines, visibleTabs } from '../contributor'
import { jobKey, useGame, useStore } from '../store'
import { S } from '../strings'

export { visibleTabs }

const storeName = (store: StoreId): string => (store === 'curseforge' ? S.contributor.curseforge : S.contributor.github)

export function ContributorSection(): ReactNode {
  const [view, setView] = useState<ContributorView | null>(null)
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const signedIn = useRef(false)
  const signingOut = useRef(false)

  useEffect(() => {
    const apply = (next: ContributorView): void => {
      // A session that ends without the user asking is an expiry; the saved tokens and ids stay.
      if (signedIn.current && !next.account && !signingOut.current) setNotice(S.contributor.expired)
      if (next.account) setNotice('')
      signedIn.current = !!next.account
      signingOut.current = false
      setView(next)
    }
    api().contributorView().then(apply).catch((e) => setLoadError(errorText(e)))
    return api().onContributorChanged(apply)
  }, [])

  if (!view) {
    return (
      <section aria-labelledby="set-contributor">
        <h2 id="set-contributor" className="settings-h">
          {S.settings.contributor}
        </h2>
        {loadError ? <p className="text-error" role="alert">{loadError}</p> : <p className="muted">{S.common.loading}</p>}
      </section>
    )
  }
  const signOut = async (): Promise<void> => {
    signingOut.current = true
    try {
      await api().contributorSignOut()
    } catch (e) {
      signingOut.current = false
      setLoadError(errorText(e))
    }
  }
  if (!view.account) return <SignIn notice={notice} onDone={setView} />
  if (view.account.adminLangs.length === 0) {
    return (
      <section aria-labelledby="set-contributor">
        <h2 id="set-contributor" className="settings-h">
          {S.settings.contributor}
        </h2>
        <p className="settings-text">{S.contributor.noAdmin}</p>
        <button type="button" className="btn" onClick={() => void signOut()}>
          {S.contributor.signOut}
        </button>
      </section>
    )
  }
  return <Signed view={view} account={view.account} onView={setView} onSignOut={() => void signOut()} />
}

function Field({ label, text, children }: { label: string; text?: string; children: (id: string) => ReactNode }): ReactNode {
  const id = useId()
  return (
    <div className="contrib-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(id)}
      {text && <span className="muted contrib-note">{text}</span>}
    </div>
  )
}

function SignIn({ notice, onDone }: { notice: string; onDone: (v: ContributorView) => void }): ReactNode {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const sent = password
    // The password leaves the page state as soon as it is sent, whatever the answer.
    setPassword('')
    setBusy(true)
    setError('')
    try {
      onDone(await api().contributorSignIn(email.trim(), sent))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-labelledby="set-contributor">
      <h2 id="set-contributor" className="settings-h">
        {S.contributor.signInTitle}
      </h2>
      <p className="settings-text">{S.contributor.signInText}</p>
      {notice && (
        <p className="status status-warn contrib-gap" role="status">
          {notice}
        </p>
      )}
      <form className="contrib-form" onSubmit={(e) => void submit(e)}>
        <Field label={S.contributor.email}>
          {(id) => <input id={id} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label={S.contributor.password}>
          {(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="contrib-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || email.trim() === '' || password === ''}>
            {busy ? `${S.contributor.signingIn}…` : S.contributor.signIn}
          </button>
        </div>
        {error && (
          <p className="text-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}

type Tab = 'stores' | 'release'

function Signed({ view, account, onView, onSignOut }: { view: ContributorView; account: NonNullable<ContributorView['account']>; onView: (v: ContributorView) => void; onSignOut: () => void }): ReactNode {
  const tabs = visibleTabs(view, view.config)
  const [tab, setTab] = useState<Tab>('stores')
  const [lang, setLang] = useState(account.adminLangs[0] ?? '')
  const shown: Tab = tabs.includes(tab) ? tab : 'stores'
  const chosen = account.adminLangs.includes(lang) ? lang : (account.adminLangs[0] ?? '')
  return (
    <section aria-labelledby="set-contributor">
      <div className="settings-title-row">
        <h2 id="set-contributor" className="settings-h">
          {S.settings.contributor}
        </h2>
        <button type="button" className="link" onClick={onSignOut}>
          {S.contributor.signOut}
        </button>
      </div>
      <p className="settings-text">{S.contributor.signedInAs(account.email)}</p>
      {account.adminLangs.length > 1 && (
        <div className="contrib-lang">
          <Select label={S.contributor.language} value={chosen} onChange={setLang}>
            {account.adminLangs.map((l) => (
              <option key={l} value={l}>
                {languageName(l)}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="subtabs" role="tablist" aria-label={S.settings.contributor}>
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" id={`ctab-${t}`} aria-selected={shown === t} aria-controls={`cpanel-${t}`} className="subtab" onClick={() => setTab(t)}>
            {t === 'stores' ? S.contributor.tabStores : S.contributor.tabRelease}
          </button>
        ))}
      </div>
      {shown === 'stores' ? (
        <div role="tabpanel" id="cpanel-stores" aria-labelledby="ctab-stores">
          {!view.canStoreSecrets && <p className="status status-warn contrib-gap">{S.contributor.unsafeStorage}</p>}
          <StoreForm store="curseforge" view={view} lang={chosen} onView={onView} />
          <StoreForm store="github" view={view} lang={chosen} onView={onView} />
        </div>
      ) : (
        <div role="tabpanel" id="cpanel-release" aria-labelledby="ctab-release">
          <Release view={view} lang={chosen} />
        </div>
      )}
    </section>
  )
}

function StoreForm({ store, view, lang, onView }: { store: StoreId; view: ContributorView; lang: string; onView: (v: ContributorView) => void }): ReactNode {
  const { config } = view
  const isCf = store === 'curseforge'
  const folders = languageFolders(lang)
  const [token, setToken] = useState('')
  const [projects, setProjects] = useState<Record<string, string>>(config.projects)
  const [repo, setRepo] = useState(config.repo)
  const [versions, setVersions] = useState(config.gameVersions)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const hasToken = isCf ? config.hasCfToken : config.hasGhToken

  const save = async (removeToken = false): Promise<void> => {
    setBusy(true)
    setError('')
    setSaved(false)
    const sentToken = removeToken ? '' : token
    try {
      const kept = Object.fromEntries(Object.entries(projects).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]))
      onView(
        await api().contributorSaveStore(
          isCf
            ? { store, ...(sentToken !== '' || removeToken ? { token: sentToken } : {}), projects: kept, gameVersions: versions.trim() }
            : { store, ...(sentToken !== '' || removeToken ? { token: sentToken } : {}), repo: repo.trim() }
        )
      )
      setToken('')
      setSaved(true)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="contrib-store"
      aria-label={storeName(store)}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h3 className="contrib-store-h">{storeName(store)}</h3>
      {view.canStoreSecrets ? (
        <Field label={S.contributor.token} text={hasToken ? S.contributor.tokenSet : S.contributor.tokenNotSet}>
          {(id) => (
            <div className="path-line">
              <input id={id} className="input" type="password" autoComplete="off" spellCheck={false} placeholder={hasToken ? S.contributor.tokenPlaceholderSet : ''} value={token} onChange={(e) => setToken(e.target.value)} />
              {hasToken && (
                <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>
                  {S.contributor.removeToken}
                </button>
              )}
            </div>
          )}
        </Field>
      ) : (
        <p className="status status-warn">{S.contributor.unsafeStorage}</p>
      )}
      {isCf ? (
        <>
          <span className="field-label">{S.contributor.projectIds}</span>
          <span className="muted contrib-note">{S.contributor.projectIdsText}</span>
          {folders.map((f) => (
            <Field key={f} label={f}>
              {(id) => <input id={id} className="input" inputMode="numeric" value={projects[f] ?? ''} onChange={(e) => setProjects({ ...projects, [f]: e.target.value })} />}
            </Field>
          ))}
          <Field label={S.contributor.gameVersions} text={S.contributor.gameVersionsText}>
            {(id) => <input id={id} className="input" value={versions} onChange={(e) => setVersions(e.target.value)} />}
          </Field>
        </>
      ) : (
        <Field label={S.contributor.repo} text={S.contributor.repoText}>
          {(id) => <input id={id} className="input" placeholder="owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} />}
        </Field>
      )}
      <div className="contrib-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? `${S.contributor.saving}…` : S.contributor.save}
        </button>
        {saved && !error && (
          <span className="status status-ok" role="status">
            {S.contributor.saved}
          </span>
        )}
      </div>
      {error && (
        <p className="text-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

function Release({ view, lang }: { view: ContributorView; lang: string }): ReactNode {
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
    api()
      .contributorRows(gameId, lang, store)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && (setRows([]), setRowsError(errorText(e))))
    return () => {
      alive = false
    }
  }, [gameId, lang, store, reload, refresh])

  useEffect(() => {
    if (reload > 0) api().contributorView().then((v) => setLastRun(v.lastRun)).catch(() => undefined)
  }, [reload])

  useEffect(() => setLastRun(view.lastRun), [view.lastRun])

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
        <button type="button" className="btn btn-primary" disabled={busy || count === 0} onClick={() => void publish()}>
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

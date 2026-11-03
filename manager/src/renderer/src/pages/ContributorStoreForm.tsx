import { useState, type ReactNode } from 'react'
import { languageFolders } from '@shared/products'
import type { ContributorView, StoreId } from '@shared/types'
import { api, errorText } from '../api'
import { Field } from '../components/ContributorField'
import { storeName } from '../contributor'
import { S } from '../strings'

export function StoreForm({ store, view, lang, onView }: { store: StoreId; view: ContributorView; lang: string; onView: (v: ContributorView) => void }): ReactNode {
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

import { useState, type ReactNode } from 'react'
import { languageFolders } from '@shared/products'
import type { ContributorView, StoreId } from '@shared/types'
import { api, errorText } from '../api'
import { Field } from '../components/ContributorField'
import { LanguageTabs, useLanguageTab } from '../components/LanguageTabs'
import { storeFormInput, storeName } from '../contributor'
import { S } from '../strings'

export function StoreForm({ store, view, onView }: { store: StoreId; view: ContributorView; onView: (v: ContributorView) => void }): ReactNode {
  const { config } = view
  const isCf = store === 'curseforge'
  const langs = view.account?.adminLangs ?? []
  const [lang, setLang] = useLanguageTab(langs)
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
    try {
      onView(await api().contributorSaveStore(storeFormInput(store, { token, removeToken, projects, repo, versions })))
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
      {isCf ? (
        <>
          <span className="field-label">{S.contributor.projectIds}</span>
          <span className="muted contrib-note">{S.contributor.projectIdsText}</span>
          <LanguageTabs langs={langs} value={lang} onChange={setLang} label={S.contributor.projectIds}>
            {languageFolders(lang).map((f) => (
              <Field key={f} label={f}>
                {(id) => <input id={id} className="input" inputMode="numeric" value={projects[f] ?? ''} onChange={(e) => setProjects({ ...projects, [f]: e.target.value })} />}
              </Field>
            ))}
          </LanguageTabs>
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

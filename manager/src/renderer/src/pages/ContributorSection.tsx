import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { languageName } from '@shared/products'
import type { ContributorView } from '@shared/types'
import { api, errorText } from '../api'
import { Field } from '../components/ContributorField'
import { Select } from '../components/Controls'
import { visibleTabs } from '../contributor'
import { Release } from './ContributorRelease'
import { StoreForm } from './ContributorStoreForm'
import { S } from '../strings'

export { visibleTabs }

export function ContributorSection(): ReactNode {
  const [view, setView] = useState<ContributorView | null>(null)
  const [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const signedIn = useRef(false)
  // The ref lets the event handler see the latest answer without resubscribing.
  const apply = useRef((next: ContributorView, asked = false): void => {
    // A session that ends without the user asking is an expiry; the saved tokens and ids stay.
    if (signedIn.current && !next.account && !asked) setNotice(S.contributor.expired)
    if (next.account || asked) setNotice('')
    signedIn.current = !!next.account
    setView(next)
  }).current

  useEffect(() => {
    api().contributorView().then((v) => apply(v, true)).catch((e) => setLoadError(errorText(e)))
    return api().onContributorChanged((v) => apply(v))
  }, [apply])

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
    try {
      apply(await api().contributorSignOut(), true)
    } catch (e) {
      setLoadError(errorText(e))
    }
  }
  if (!view.account) return <SignIn notice={notice} onDone={(v) => apply(v, true)} />
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
  return <Signed view={view} account={view.account} onView={(v) => apply(v, true)} onSignOut={() => void signOut()} />
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

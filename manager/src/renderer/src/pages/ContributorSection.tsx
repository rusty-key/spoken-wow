import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { ContributorView } from '@shared/types'
import { api, errorText } from '../api'
import { Field } from '../components/ContributorField'
import { releaseAvailable } from '../contributor'
import { StoreForm } from './ContributorStoreForm'
import { useStore } from '../store'
import { S } from '../strings'

export function ContributorSection(): ReactNode {
  const { state, actions } = useStore()
  const view = state.contributor
  const [error, setError] = useState('')

  useEffect(() => {
    void actions.refreshContributor()
  }, [actions])

  if (!view) {
    return (
      <section aria-labelledby="set-contributor">
        <h2 id="set-contributor" className="settings-h">
          {S.settings.contributor}
        </h2>
        {state.contributorError ? <p className="text-error" role="alert">{state.contributorError}</p> : <p className="muted">{S.common.loading}</p>}
      </section>
    )
  }
  const signOut = async (): Promise<void> => {
    setError('')
    try {
      actions.applyContributor(await api().contributorSignOut())
    } catch (e) {
      setError(errorText(e))
    }
  }
  if (!view.account && view.siteUnreachable) return <SiteUnreachable onView={actions.applyContributor} />
  if (!view.account) return <SignIn notice={state.contributorExpired ? S.contributor.expired : ''} onDone={actions.applyContributor} />
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
        {error && <p className="text-error" role="alert">{error}</p>}
      </section>
    )
  }
  return (
    <section aria-labelledby="set-contributor">
      <div className="settings-title-row">
        <h2 id="set-contributor" className="settings-h">
          {S.settings.contributor}
        </h2>
        <button type="button" className="link" onClick={() => void signOut()}>
          {S.contributor.signOut}
        </button>
      </div>
      <p className="settings-text">{S.contributor.signedInAs(view.account.email)}</p>
      {error && <p className="text-error" role="alert">{error}</p>}
      {!view.canStoreSecrets && <p className="status status-warn contrib-gap">{S.contributor.unsafeStorage}</p>}
      {releaseAvailable(view) ? (
        <p className="contrib-gap">
          <button type="button" className="btn" onClick={() => actions.navigate('release')}>
            {S.contributor.openRelease}
          </button>
        </p>
      ) : (
        <p className="muted contrib-gap">{S.contributor.releaseHint}</p>
      )}
      <StoreForm store="curseforge" view={view} onView={actions.applyContributor} />
      <StoreForm store="github" view={view} onView={actions.applyContributor} />
    </section>
  )
}

/** The session may be fine, so a sign-in form would ask for a password nothing needs. */
function SiteUnreachable({ onView }: { onView: (v: ContributorView) => void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const retry = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      onView(await api().contributorView())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-labelledby="set-contributor">
      <h2 id="set-contributor" className="settings-h">
        {S.settings.contributor}
      </h2>
      <p className="status status-warn contrib-gap" role="status">
        {S.contributor.siteUnreachable}
      </p>
      <button type="button" className="btn" disabled={busy} onClick={() => void retry()}>
        {S.common.retry}
      </button>
      {error && (
        <p className="text-error" role="alert">
          {error}
        </p>
      )}
    </section>
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

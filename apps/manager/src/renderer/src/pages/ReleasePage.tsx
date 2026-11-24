import type { ReactNode } from 'react'
import { RailTop } from '../components/Brand'
import { NoGame } from '../components/EmptyGames'
import { LanguageTabs, useLanguageTab } from '../components/LanguageTabs'
import { releaseAvailable } from '../contributor'
import { useGame, useStore } from '../store'
import { S } from '../strings'
import { Release } from './ContributorRelease'

export function ReleasePage(): ReactNode {
  const { state, actions } = useStore()
  const game = useGame()
  const view = state.contributor
  const langs = view?.account?.adminLangs ?? []
  const [lang, setLang] = useLanguageTab(langs)

  if (!game) return <NoGame />
  return (
    <div className="frame">
      <aside className="rail scroll" aria-label={S.tabs.release}>
        <RailTop game={game} />
      </aside>
      <section className="center scroll">
        <div className="center-inner">
          <div className="page-title-block">
            <h1 className="page-title">{S.tabs.release}</h1>
            <p className="page-sub">{S.contributor.releaseIntro}</p>
          </div>
          {!view ? (
            state.contributorError ? <p className="text-error" role="alert">{state.contributorError}</p> : <p className="muted">{S.common.loading}…</p>
          ) : releaseAvailable(view) ? (
            <LanguageTabs langs={langs} value={lang} onChange={setLang} label={S.tabs.release}>
              <Release view={view} lang={lang} />
            </LanguageTabs>
          ) : (
            <>
              <p className="settings-text">{S.contributor.releaseUnavailable}</p>
              <button type="button" className="btn" onClick={() => actions.navigate('settings')}>
                {S.contributor.openSettings}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

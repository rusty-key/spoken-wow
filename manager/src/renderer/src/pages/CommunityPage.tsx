import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CommunityPack, Section } from '@shared/types'
import { LANGUAGES, languageName } from '@shared/products'
import { api } from '../api'
import { statusOf } from '../catalog'
import { RailTop } from '../components/Brand'
import { NoGame } from '../components/EmptyGames'
import { IconAlert } from '../components/Icons'
import { PackRow } from '../components/PackRow'
import { formatBytes } from '../format'
import { useGame, useStore } from '../store'
import { COMMUNITY_README_URL, S } from '../strings'

const SECTIONS: Section[] = ['quests', 'places', 'readables']
const NOTICE_KEY = 'spoken-manager.community-notice-dismissed'
function noticeDismissed(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

/** The address of a link only when it is https; anything else the registry sends is not shown. */
function httpsUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

const open = (url: string): void => void api().openExternal(url).catch(() => undefined)

export function CommunityPage(): ReactNode {
  const { state, actions } = useStore()
  const game = useGame()
  const { community } = state
  const [lang, setLang] = useState('')
  const [section, setSection] = useState<Section | ''>('')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState(() => !noticeDismissed())

  // The main process caches the list, so looking again on each visit is cheap.
  useEffect(() => {
    void actions.refreshCommunity()
  }, [actions])

  const languages = useMemo(() => {
    const have = new Set(community.packs.map((p) => p.lang))
    const known = LANGUAGES.filter((l) => have.has(l.code)).map((l) => l.code)
    return [...known, ...[...have].filter((c) => !known.includes(c)).sort()]
  }, [community.packs])

  if (!game) return <NoGame />

  const needle = query.trim().toLowerCase()
  const shown = community.packs.filter(
    (p) =>
      (!lang || p.lang === lang) &&
      (!section || p.section === section) &&
      (!needle || p.title.toLowerCase().includes(needle) || p.author.toLowerCase().includes(needle))
  )
  const clear = (): void => {
    setLang('')
    setSection('')
    setQuery('')
  }
  const dismiss = (): void => {
    setNotice(false)
    try {
      localStorage.setItem(NOTICE_KEY, '1')
    } catch {
      /* the box comes back next time */
    }
  }

  const noList = community.packs.length === 0
  const failed = noList && (community.offline || !!community.error)

  return (
    <div className="frame">
      <aside className="rail scroll" aria-label={S.community.title}>
        <RailTop game={game} />
        <div className="rail-bottom">
          <button type="button" className="btn btn-play btn-wrap" onClick={() => open(COMMUNITY_README_URL)}>
            {S.community.share}
          </button>
        </div>
      </aside>

      <section className="center scroll">
        <div className="center-inner">
          <div className="page-title-block">
            <h1 className="page-title">{S.community.title}</h1>
            <p className="page-sub">{S.community.intro}</p>
            <p className="page-note">{S.community.needsNewer}</p>
          </div>

          {notice && (
            <div className="notice notice-caution" role="note">
              <IconAlert size={18} />
              <p>{S.community.notice}</p>
              <button type="button" className="btn btn-sm" onClick={dismiss}>
                {S.common.dismiss}
              </button>
            </div>
          )}

          {community.offline && !noList && (
            <div className="notice notice-warn" role="status">
              {S.community.offline}
            </div>
          )}

          {failed ? (
            <div className="card pad state-box" role="alert">
              <h2>{community.offline ? S.community.errorTitle : S.community.unreadable}</h2>
              <p className="muted">{S.community.errorText}</p>
              <button type="button" className="btn" onClick={() => void actions.refreshCommunity(true)}>
                {S.common.retry}
              </button>
            </div>
          ) : noList ? (
            <div className="card pad state-box">
              <h2>{S.community.emptyTitle}</h2>
              <p className="muted">{S.community.emptyText}</p>
              <button type="button" className="btn btn-primary" onClick={() => open(COMMUNITY_README_URL)}>
                {S.community.share}
              </button>
            </div>
          ) : (
            <>
              <div className="filter-bar">
                <div className="filter-group">
                  <span className="field-label" id="community-lang">
                    {S.community.language}
                  </span>
                  <div className="pills" role="group" aria-labelledby="community-lang">
                    <button type="button" className="pill" aria-pressed={lang === ''} onClick={() => setLang('')}>
                      {S.community.allLanguages}
                    </button>
                    {languages.map((code) => (
                      <button key={code} type="button" className="pill" aria-pressed={lang === code} onClick={() => setLang(code)}>
                        {languageName(code)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="filter-group">
                  <span className="field-label" id="community-section">
                    {S.community.section}
                  </span>
                  <div className="pills" role="group" aria-labelledby="community-section">
                    <button type="button" className="pill" aria-pressed={section === ''} onClick={() => setSection('')}>
                      {S.community.allSections}
                    </button>
                    {SECTIONS.map((sec) => (
                      <button key={sec} type="button" className="pill" aria-pressed={section === sec} onClick={() => setSection(sec)}>
                        {S.voices.sections[sec].title}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="list-bar">
                <p className="count" aria-live="polite">
                  {S.community.count(shown.length, community.packs.length)}
                </p>
                <div className="search-group">
                  <label className="sr-only" htmlFor="community-search">
                    {S.community.searchLabel}
                  </label>
                  <input
                    id="community-search"
                    type="search"
                    className="search"
                    placeholder={S.community.search}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>

              {shown.length === 0 ? (
                <div className="card pad state-box">
                  <p className="muted">{S.community.noMatch}</p>
                  <button type="button" className="btn btn-sm" onClick={clear}>
                    {S.community.clear}
                  </button>
                </div>
              ) : (
                <section className="card section" aria-label={S.community.title}>
                  <ul className="list">
                    {shown.map((pack) => (
                      <CommunityRow key={pack.id} pack={pack} gameId={game.id} />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function CommunityRow({ pack, gameId }: { pack: CommunityPack; gameId: string }): ReactNode {
  const { state } = useStore()
  const game = state.games.find((g) => g.id === gameId)
  const status = statusOf(state, gameId, `community/${pack.id}`)
  const present = !!status && status.state !== 'not-installed'
  const link = httpsUrl(pack.homepage)
  const blocked = status?.blockedReason ?? null
  return (
    <PackRow
      gameId={gameId}
      productId={`community/${pack.id}`}
      writable={game?.writable ?? false}
      blockedReason={blocked}
      released
      title={pack.title}
      text={`${S.community.by(pack.author)} · ${languageName(pack.lang)} · ${S.voices.sections[pack.section].title}`}
    >
      {pack.description && (
        <span className="row-text ellipsis" title={pack.description}>
          {pack.description}
        </span>
      )}
      <span className="row-text row-facts">
        <span>v{pack.version}</span>
        <span>{formatBytes(pack.size)}</span>
        <span>{pack.license || S.community.licenseUnknown}</span>
        {present && status?.installedVersion && (
          <span>
            {S.community.installedVersion(status.installedVersion)}
            {status.state === 'update-available' ? ` → ${pack.version}` : ''}
          </span>
        )}
        {link && (
          <button type="button" className="link link-inline" aria-label={S.community.authorPageLabel(pack.author)} onClick={() => open(link)}>
            {S.community.authorPage}
          </button>
        )}
      </span>
    </PackRow>
  )
}

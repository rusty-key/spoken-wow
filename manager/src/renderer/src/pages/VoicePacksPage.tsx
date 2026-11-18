import { useMemo, useState, type ReactNode } from 'react'
import type { Product, ProductStatus, Section } from '@shared/types'
import { isChannelRelease } from '@shared/channel'
import { BASE_LANGUAGE, LANGUAGES, languageName } from '@shared/products'
import { jobBusy, latestOf, releasesFor, statusOf } from '../catalog'
import { RailTop } from '../components/Brand'
import { NoGame } from '../components/EmptyGames'
import { PackRow } from '../components/PackRow'
import { formatBytes, formatDate } from '../format'
import { jobKey, useGame, useStore } from '../store'
import { S } from '../strings'
import { ALL_AUTHORS, authorsOf, chosenAuthor, groupByAuthor, type Author } from '../voices'

const SECTIONS: Section[] = ['quests', 'places', 'readables', 'bosses']

export function VoicePacksPage(): ReactNode {
  const { state, actions } = useStore()
  const game = useGame()
  const [confirmAll, setConfirmAll] = useState(false)
  const pre = state.settings.includePrereleases

  const voices = useMemo(() => state.products.filter((p) => p.kind === 'voices'), [state.products])
  const released = (p: Product): boolean => releasesFor(state.catalog, p.id, pre).length > 0
  const withRelease = new Set(voices.filter(released).map((p) => p.lang))
  const chosen = state.settings.voiceLanguage || BASE_LANGUAGE
  const languages = state.languages.length > 0 ? state.languages : LANGUAGES
  const chips = languages.filter((l) => withRelease.has(l.code) || l.code === chosen)

  if (!game) return <NoGame />

  const inLang = voices.filter((p) => p.lang === chosen)
  const authors = authorsOf(inLang.filter(released))
  const author = chosenAuthor(state.settings.voiceAuthors[chosen], authors)
  const byAuthor = (p: Product): boolean => author === ALL_AUTHORS || authors.keyOf(p) === author
  const chooseAuthor = (key: string): void => {
    setConfirmAll(false)
    void actions.setSettings({ voiceAuthors: { ...state.settings.voiceAuthors, [chosen]: key } })
  }
  const statusFor = (p: Product): ProductStatus | undefined => statusOf(state, game.id, p.id)

  // Everything of the language that is not installed: the one "All quests" bundle instead of its
  // four split packs.
  const todo = inLang.filter((p) => {
    if (!released(p)) return false
    if (p.section === 'quests' && p.pack !== 'all') return false
    const s = statusFor(p)
    if (s?.state === 'linked' || jobBusy(state.jobs[jobKey(game.id, p.id)])) return false
    return (s?.state ?? 'not-installed') === 'not-installed'
  })
  const totalBytes = todo.reduce((sum, p) => sum + (latestOf(state, game.id, p.id)?.assetSize ?? 0), 0)
  const lang = languages.find((l) => l.code === chosen)?.name ?? languageName(chosen)
  const installAll = (): void => {
    setConfirmAll(false)
    void (async () => {
      for (const p of todo) await actions.install(game.id, p.id)
    })()
  }
  const showInstallAll = chips.some((c) => c.code === chosen && withRelease.has(c.code))

  return (
    <div className="frame">
      <aside className="rail scroll" aria-label={S.voices.title}>
        <RailTop game={game} />
        <div className="rail-bottom">
          {showInstallAll &&
            (confirmAll ? (
              <div className="confirm" role="alertdialog" aria-label={S.voices.installAll(lang)}>
                <p>{S.voices.confirmAll(todo.length, `~${formatBytes(totalBytes)}`, lang)}</p>
                <div className="confirm-actions">
                  <button type="button" className="btn btn-primary" onClick={installAll}>
                    {S.voices.confirmInstall}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmAll(false)}>
                    {S.common.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-play btn-wrap" disabled={todo.length === 0 || !game.writable} onClick={() => setConfirmAll(true)}>
                {todo.length === 0 ? S.voices.allInstalled(lang) : S.voices.installAll(lang)}
              </button>
            ))}
        </div>
      </aside>

      <section className="center scroll">
        <div className="center-inner">
          <h1 className="page-title">{S.voices.title}</h1>
          <div className="filter-group">
            <span className="field-label" id="voice-lang">
              {S.voices.languages}
            </span>
            <div className="pills" role="group" aria-labelledby="voice-lang">
              {chips.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className="pill"
                  aria-pressed={chosen === l.code}
                  onClick={() => {
                    setConfirmAll(false)
                    void actions.setSettings({ voiceLanguage: l.code })
                  }}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </div>
          {authors.list.length > 1 && (
            <div className="filter-group">
              <span className="field-label" id="voice-author">
                {S.voices.author}
              </span>
              <div className="pills" role="group" aria-labelledby="voice-author">
                <button type="button" className="pill" aria-pressed={author === ALL_AUTHORS} onClick={() => chooseAuthor(ALL_AUTHORS)}>
                  {S.voices.allAuthors}
                </button>
                {authors.list.map((a) => (
                  <button key={a.key} type="button" className="pill" aria-pressed={author === a.key} onClick={() => chooseAuthor(a.key)}>
                    {authorName(a)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {voices.length === 0 || inLang.length === 0 || !inLang.some(released) ? (
            <p className="card pad muted">
              {S.common.notReleased}. {S.voices.nothingReleased}
            </p>
          ) : (
            <div className="sections">
              {SECTIONS.map((section) => {
                const all = inLang.filter((p) => p.section === section)
                const some = all.filter(released)
                // With nothing released, the section still shows its first product, as not released.
                const groups = some.length > 0 ? groupByAuthor(some.filter(byAuthor), authors) : all.slice(0, 1).map((p) => ({ author: null, rows: [p] }))
                if (groups.length === 0) return null
                const meta = S.voices.sections[section]
                return (
                  <section key={section} className="card section" aria-labelledby={`sec-${section}`}>
                    <header className="section-head">
                      <h2 id={`sec-${section}`}>{meta.title}</h2>
                      <p>{meta.text}</p>
                    </header>
                    <ul className="list">
                      {groups.map(({ author, rows }) => (
                        <AuthorRows key={author?.key ?? ''} heading={groups.length > 1 && author ? authorName(author) : null} rows={rows} gameId={game.id} writable={game.writable} />
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export function authorName(author: Author): string {
  return author.name || S.voices.pageAuthor
}

/** One author's rows of a section: the bundle, then the split packs. */
function AuthorRows({ heading, rows, gameId, writable }: { heading: string | null; rows: Product[]; gameId: string; writable: boolean }): ReactNode {
  const bundle = rows.filter((p) => p.pack === 'all' || p.pack === undefined)
  const split = rows.filter((p) => p.pack && p.pack !== 'all')
  return (
    <>
      {heading !== null && <li className="row-label">{heading}</li>}
      {bundle.map((p) => (
        <VoiceRow key={p.id} product={p} gameId={gameId} writable={writable} />
      ))}
      {split.length > 0 && (
        <li className="row-label" aria-hidden="true">
          {S.voices.splitHint}
        </li>
      )}
      {split.map((p) => (
        <VoiceRow key={p.id} product={p} gameId={gameId} writable={writable} />
      ))}
    </>
  )
}

function packName(p: Product): string {
  if (p.section === 'quests' && p.pack) return S.voices.packNames[p.pack]
  return S.voices.sections[p.section ?? 'quests'].title
}

function VoiceRow({ product, gameId, writable }: { product: Product; gameId: string; writable: boolean }): ReactNode {
  const { state } = useStore()
  const status = statusOf(state, gameId, product.id)
  const latest = latestOf(state, gameId, product.id)
  const s = status?.state ?? 'not-installed'
  const present = s !== 'not-installed'
  const channel = isChannelRelease(latest)
  const size = latest ? formatBytes(status?.delta ? status.delta.bytes : latest.assetSize) : ''
  return (
    <PackRow
      gameId={gameId}
      productId={product.id}
      writable={writable}
      released={!!latest}
      title={packName(product)}
      text={
        <>
          {product.team && !product.team.official ? `${S.voices.by(product.team.name)} · ` : ''}
          {latest ? `${size} · ` : ''}
          {present && status?.installedVersion ? S.voices.installedVersion(status.installedVersion) : S.voices.notInstalled}
          {s === 'update-available' && latest ? ` → ${channel ? formatDate(latest.publishedAt) : latest.version}` : ''}
        </>
      }
    />
  )
}

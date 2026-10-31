import { useMemo, useState, type ReactNode } from 'react'
import type { Product, ProductStatus, Section } from '@shared/types'
import { isChannelRelease } from '@shared/channel'
import { BASE_LANGUAGE, LANGUAGES, languageName } from '@shared/products'
import { jobBusy, latestOf, releasesFor, statusOf } from '../catalog'
import { Wordmark } from '../components/Brand'
import { NoGame } from '../components/EmptyGames'
import { PackRow } from '../components/PackRow'
import { formatBytes, formatDate } from '../format'
import { jobKey, useGame, useStore } from '../store'
import { S } from '../strings'

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
  const chips = LANGUAGES.filter((l) => withRelease.has(l.code) || l.code === chosen)

  if (!game) return <NoGame />

  const inLang = voices.filter((p) => p.lang === chosen)
  const statusFor = (p: Product): ProductStatus | undefined => statusOf(state, game.id, p.id)
  const english = chosen === BASE_LANGUAGE

  // Everything of the language that is not installed. English takes the one "All quests"
  // bundle instead of its four split packs.
  const todo = inLang.filter((p) => {
    if (!released(p)) return false
    if (english && p.section === 'quests' && p.pack !== 'all') return false
    const s = statusFor(p)
    if (s?.state === 'linked' || jobBusy(state.jobs[jobKey(game.id, p.id)])) return false
    return (s?.state ?? 'not-installed') === 'not-installed'
  })
  const totalBytes = todo.reduce((sum, p) => sum + (latestOf(state, game.id, p.id)?.assetSize ?? 0), 0)
  const lang = languageName(chosen)
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
        <div className="rail-top">
          <Wordmark flavor={game.flavor} kicker />
          <p className="rail-game">{game.gameVersion ? `${game.label} · ${game.gameVersion}` : game.label}</p>
        </div>
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

          {voices.length === 0 || inLang.length === 0 || !inLang.some(released) ? (
            <p className="card pad muted">
              {S.common.notReleased}. {S.voices.nothingReleased}
            </p>
          ) : (
            <div className="sections">
              {SECTIONS.map((section) => {
                const all = inLang.filter((p) => p.section === section)
                const some = all.filter(released)
                const rows = some.length > 0 ? some : all.slice(0, 1)
                if (rows.length === 0) return null
                const bundle = rows.filter((p) => p.pack === 'all' || p.pack === undefined)
                const split = rows.filter((p) => p.pack && p.pack !== 'all')
                const meta = S.voices.sections[section]
                return (
                  <section key={section} className="card section" aria-labelledby={`sec-${section}`}>
                    <header className="section-head">
                      <h2 id={`sec-${section}`}>{meta.title}</h2>
                      <p>{meta.text}</p>
                    </header>
                    <ul className="list">
                      {bundle.map((p) => (
                        <VoiceRow key={p.id} product={p} gameId={game.id} writable={game.writable} />
                      ))}
                      {split.length > 0 && (
                        <li className="row-label" aria-hidden="true">
                          {S.voices.splitHint}
                        </li>
                      )}
                      {split.map((p) => (
                        <VoiceRow key={p.id} product={p} gameId={game.id} writable={game.writable} />
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

function packName(p: Product): string {
  if (p.section === 'quests' && p.lang === BASE_LANGUAGE && p.pack) return S.voices.packNames[p.pack]
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
          {latest ? `${size} · ` : ''}
          {present && status?.installedVersion ? S.voices.installedVersion(status.installedVersion) : S.voices.notInstalled}
          {s === 'update-available' && latest ? ` → ${channel ? formatDate(latest.publishedAt) : latest.version}` : ''}
        </>
      }
    />
  )
}

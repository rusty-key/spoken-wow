import { useState, type ReactNode } from 'react'
import type { Flavor, GameInstall } from '@shared/types'
import { SUPPORTED_FLAVORS } from '@shared/types'
import { releasesFor, statusOf } from '../catalog'
import { HeroArt } from '../components/Brand'
import { GameCard, MissingCard } from '../components/GameCard'
import { formatDate } from '../format'
import { Markdown } from '../markdown'
import { useGame, useStore, useSupportedGames, type State } from '../store'
import { S } from '../strings'

type Filter = 'all' | 'with' | 'without'

const hasSpoken = (state: State, g: GameInstall): boolean => (statusOf(state, g.id, 'spoken')?.state ?? 'not-installed') !== 'not-installed'

export function HomePage(): ReactNode {
  const { state, actions } = useStore()
  const games = useSupportedGames()
  const current = useGame()
  const [filter, setFilter] = useState<Filter>('all')

  const counts = {
    all: games.length,
    with: games.filter((g) => hasSpoken(state, g)).length,
    without: games.filter((g) => !hasSpoken(state, g)).length
  }
  // The three supported games in a fixed order; one the scan did not find is a disabled card, under All only.
  const slots = SUPPORTED_FLAVORS.flatMap((flavor): ({ game: GameInstall } | { missing: Flavor })[] => {
    const found = games.filter((g) => g.flavor === flavor)
    if (found.length === 0) return filter === 'all' ? [{ missing: flavor }] : []
    return found.filter((g) => filter === 'all' || (filter === 'with') === hasSpoken(state, g)).map((game) => ({ game }))
  })
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: S.home.filterAll },
    { id: 'with', label: S.home.filterWith },
    { id: 'without', label: S.home.filterWithout }
  ]
  const newest = releasesFor(state.catalog, 'spoken', state.settings.includePrereleases)[0]

  return (
    <div className="page scroll">
      <div className="page-inner">
        <div className="page-head">
          <h1>{S.home.title}</h1>
          <div className="pill-row">
            <nav className="pills" aria-label={S.home.filters}>
              {filters.map((f) => (
                <button key={f.id} type="button" className="pill" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                  <span className="pill-count">{counts[f.id]}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {slots.length > 0 ? (
          <div className="game-grid">
            {slots.map((slot) => ('game' in slot ? <GameCard key={slot.game.id} game={slot.game} /> : <MissingCard key={slot.missing} flavor={slot.missing} />))}
          </div>
        ) : (
          <p className="muted">{S.home.noMatch}</p>
        )}

        {newest && (
          <section className="hero" aria-labelledby="whats-new-title">
            <HeroArt flavor={current?.flavor ?? 'forever'} />
            <div className="hero-body">
              <h2 id="whats-new-title" className="eyebrow">
                {S.home.whatsNew}
              </h2>
              <p className="hero-title">
                {newest.version}
                {newest.prerelease && <span className="tag tag-warn">{S.spoken.prerelease}</span>}
                <span className="hero-date">{formatDate(newest.publishedAt)}</span>
              </p>
              <div className="hero-notes">
                <Markdown text={newest.notes || S.spoken.noNotes} />
              </div>
              <button type="button" className="btn btn-block" disabled={games.length === 0} onClick={() => actions.navigate('spoken', games[0]?.id, 'changelog')}>
                {S.home.readAll}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

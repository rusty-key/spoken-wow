import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import icon from '../assets/spoken.png'
import { formatTime } from '../format'
import type { Flavor, GameInstall } from '@shared/types'
import { SUPPORTED_FLAVORS } from '@shared/types'
import { useGame, useStore, useSupportedGames, type Page } from '../store'
import { S } from '../strings'
import { flavorLook } from '../catalog'
import { releaseAvailable } from '../contributor'
import { GameIcon } from './Brand'
import { RestartButton } from './RestartButton'
import { IconGear, IconPlus, IconRefresh, IconWinClose, IconWinMaximize, IconWinMinimize, IconWinRestore } from './Icons'

/** The tabs are built per draw: a list built at load would keep the first language. */
export function TopBar(): ReactNode {
  const { state, actions } = useStore()
  const { catalog } = state
  const tabs: { page: Page; label: string }[] = [
    { page: 'home', label: S.tabs.home },
    { page: 'spoken', label: S.tabs.spoken },
    { page: 'voices', label: S.tabs.voices },
    { page: 'community', label: S.tabs.community },
    ...(releaseAvailable(state.contributor) ? [{ page: 'release' as Page, label: S.tabs.release }] : [])
  ]
  const tip = state.refreshing
    ? S.common.loading
    : catalog.offline
      ? S.refresh.offline
      : catalog.fetchedAt
        ? S.refresh.last(formatTime(catalog.fetchedAt))
        : S.refresh.idle
  return (
    <header className="topbar">
      <button type="button" className="brand" aria-label={`${S.appName}: ${S.tabs.home}`} onClick={() => actions.navigate('home')}>
        <img src={icon} alt="" width={40} height={40} />
      </button>
      <nav className="tabs-main" aria-label={S.tabs.main}>
        {tabs.map((t) => (
          <button key={t.page} type="button" className="tab" aria-current={state.page === t.page ? 'page' : undefined} onClick={() => actions.navigate(t.page)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <button
          type="button"
          className={`icon-btn${state.refreshing ? ' is-spinning' : ''}`}
          data-tip={tip}
          aria-label={`${S.refresh.label}. ${tip}`}
          aria-busy={state.refreshing}
          disabled={state.refreshing}
          onClick={() => void actions.refresh()}
        >
          <IconRefresh size={18} />
        </button>
        {state.appVersion && <span className="topbar-version">v{state.appVersion}</span>}
        <button type="button" className="tab tab-gear" aria-current={state.page === 'settings' ? 'page' : undefined} onClick={() => actions.navigate('settings')}>
          <IconGear size={16} />
          {S.tabs.settings}
        </button>
      </div>
      {state.platform !== 'darwin' && <WindowControls />}
    </header>
  )
}

/** Minimize, maximize and close, drawn here because the window has no system title bar. */
function WindowControls(): ReactNode {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let alive = true
    void api()
      .windowIsMaximized()
      .then((m) => alive && setMaximized(m))
      .catch(() => undefined)
    const off = api().onWindowMaximized(setMaximized)
    return () => {
      alive = false
      off()
    }
  }, [])
  const run = (call: () => Promise<void>) => () => void call().catch(() => undefined)
  return (
    <div className="window-controls">
      <button type="button" className="win-btn" aria-label={S.window.minimize} title={S.window.minimize} onClick={run(() => api().windowMinimize())}>
        <IconWinMinimize />
      </button>
      <button
        type="button"
        className="win-btn"
        aria-label={maximized ? S.window.restore : S.window.maximize}
        title={maximized ? S.window.restore : S.window.maximize}
        onClick={run(() => api().windowToggleMaximize())}
      >
        {maximized ? <IconWinRestore /> : <IconWinMaximize />}
      </button>
      <button type="button" className="win-btn win-close" aria-label={S.window.close} title={S.window.close} onClick={run(() => api().windowClose())}>
        <IconWinClose />
      </button>
    </div>
  )
}

/** The games as icon tiles under the top bar; the one the game pages show is underlined. */
export function GamesStrip(): ReactNode {
  const { state, actions } = useStore()
  const games = useSupportedGames()
  const game = useGame()
  if (!state.ready || state.page === 'settings') return null
  const onGamePage = state.page === 'spoken' || state.page === 'voices' || state.page === 'community' || state.page === 'release'
  return (
    <nav className="strip" aria-label={S.home.title}>
      <span className="strip-label">{S.home.title}</span>
      {SUPPORTED_FLAVORS.flatMap((flavor): { g: GameInstall | undefined; flavor: Flavor }[] => {
        const found = games.filter((g) => g.flavor === flavor)
        if (found.length > 0) return found.map((g) => ({ g, flavor }))
        return [{ g: undefined, flavor }]
      }).map(({ g, flavor }) => {
        if (!g) {
          const text = S.strip.missing(flavorLook(flavor).label)
          return (
            <button key={flavor} type="button" className="strip-tile is-missing" disabled aria-label={text}>
              <GameIcon flavor={flavor} />
              <span className="strip-tip" aria-hidden="true">
                {text}
              </span>
            </button>
          )
        }
        const active = onGamePage && g.id === game?.id
        return (
          <button
            key={g.id}
            type="button"
            className="strip-tile"
            aria-label={g.label}
            aria-current={active ? 'true' : undefined}
            onClick={() => {
              actions.selectGame(g.id)
              if (!onGamePage) actions.navigate('spoken', g.id)
            }}
          >
            <GameIcon flavor={g.flavor} />
            <span className="strip-tip" aria-hidden="true">
              {flavorLook(g.flavor).label}
            </span>
          </button>
        )
      })}
      <button type="button" className="strip-tile strip-add" aria-label={S.strip.add} onClick={() => actions.navigate('settings')}>
        <IconPlus size={18} />
        <span className="strip-tip" aria-hidden="true">
          {S.strip.add}
        </span>
      </button>
    </nav>
  )
}

export function Banners(): ReactNode {
  const { state } = useStore()
  const { updater, catalog } = state
  return (
    <>
      {catalog.offline && (
        <div className="banner banner-warn" role="status">
          {S.banners.offline}
        </div>
      )}
      {updater.state === 'available' && updater.url && (
        <div className="banner banner-info banner-action" role="status">
          {S.banners.updateAvailable(updater.version)}
          <button type="button" className="btn btn-sm" onClick={() => void api().openExternal(updater.url!)}>
            {S.banners.download}
          </button>
        </div>
      )}
      {updater.state === 'ready' && (
        <div className="banner banner-info banner-action" role="status">
          {updater.message ?? S.banners.updateReady(updater.version)}
          <RestartButton className="btn btn-sm" />
        </div>
      )}
      {updater.state === 'downloading' && (
        <div className="banner banner-info" role="status">
          {S.banners.updating(Math.round(updater.percent))}
        </div>
      )}
    </>
  )
}

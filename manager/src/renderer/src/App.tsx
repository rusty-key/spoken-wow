import { useEffect, useRef, type ReactNode } from 'react'
import { Backdrop } from './components/Brand'
import { SharingPrompt } from './components/SharingPrompt'
import { Banners, GamesStrip, TopBar } from './components/TopBar'
import { CommunityPage } from './pages/CommunityPage'
import { HomePage } from './pages/HomePage'
import { ReleasePage } from './pages/ReleasePage'
import { SettingsPage } from './pages/SettingsPage'
import { SpokenPage } from './pages/SpokenPage'
import { VoicePacksPage } from './pages/VoicePacksPage'
import { useGame, useStore } from './store'
import { S } from './strings'
import icon from './assets/spoken.png'

export function App(): ReactNode {
  const { state } = useStore()
  const game = useGame()
  const main = useRef<HTMLElement>(null)
  useEffect(() => {
    main.current?.querySelectorAll('.scroll').forEach((el) => el.scrollTo(0, 0))
  }, [state.page, state.gameId])
  return (
    <div className={`shell platform-${state.platform}`}>
      {state.ready && !state.fatal && game && state.page !== 'settings' && <Backdrop flavor={game.flavor} compact={state.page === 'home'} />}
      <TopBar />
      <GamesStrip />
      <Banners />
      <main className="main" ref={main} aria-busy={!state.ready}>
        {!state.ready ? (
          <div className="splash" role="status">
            <img src={icon} alt="" width={64} height={64} />
            <span>{S.common.loading}…</span>
          </div>
        ) : state.fatal ? (
          <div className="splash" role="alert">
            <span className="text-error">{state.fatal}</span>
          </div>
        ) : (
          <>
            {state.page === 'home' && <HomePage />}
            {state.page === 'spoken' && <SpokenPage />}
            {state.page === 'voices' && <VoicePacksPage />}
            {state.page === 'community' && <CommunityPage />}
            {state.page === 'release' && <ReleasePage />}
            {state.page === 'settings' && <SettingsPage />}
          </>
        )}
      </main>
      <SharingPrompt />
    </div>
  )
}

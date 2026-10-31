// The window's one store: React context + useReducer. The main process's events are the truth;
// nothing here guesses the result of an install before the job says so.
import { createContext, createElement, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from 'react'
import type { AddGameResult, UpdaterState } from '@shared/api'
import type { Catalog, CommunityCatalog, GameInstall, GenerateStatus, JobProgress, Product, ProductStatus, Settings, SharingStatus, Snapshot } from '@shared/types'
import { DEFAULT_SETTINGS, isSupportedFlavor } from '@shared/types'
import { api, errorText } from './api'
import type { Platform } from './strings'

export type Page = 'home' | 'spoken' | 'voices' | 'community' | 'settings'
export type SpokenTab = 'modules' | 'changelog'

export interface State {
  ready: boolean
  fatal?: string
  games: GameInstall[]
  settings: Settings
  catalog: Catalog
  community: CommunityCatalog
  products: Product[]
  appVersion: string
  platform: Platform
  dataPath: string
  /** By game id. */
  statuses: Record<string, ProductStatus[]>
  /** The latest job of each `gameId|productId`; finished ones stay until dismissed. */
  jobs: Record<string, JobProgress>
  updater: UpdaterState
  sharing: SharingStatus
  /** Null when this computer cannot generate (no keychain). */
  generate: GenerateStatus | null
  refreshing: boolean
  page: Page
  gameId: string
  spokenTab: SpokenTab
}

type Action =
  | { type: 'init'; snap: Snapshot; statuses: Record<string, ProductStatus[]>; page: Page; gameId: string; tab?: SpokenTab }
  | { type: 'fatal'; message: string }
  | { type: 'games'; games: GameInstall[] }
  | { type: 'catalog'; catalog: Catalog }
  | { type: 'community'; community: CommunityCatalog }
  | { type: 'settings'; settings: Settings }
  | { type: 'statuses'; gameId: string; list: ProductStatus[] }
  | { type: 'job'; job: JobProgress }
  | { type: 'dismiss'; key: string }
  | { type: 'updater'; state: UpdaterState }
  | { type: 'sharing'; status: SharingStatus }
  | { type: 'generate'; status: GenerateStatus }
  | { type: 'refreshing'; on: boolean }
  | { type: 'nav'; page: Page; gameId?: string; tab?: SpokenTab }

export const jobKey = (gameId: string, productId: string): string => `${gameId}|${productId}`

const EMPTY_CATALOG: Catalog = { fetchedAt: null, offline: false, releases: {} }
const EMPTY_COMMUNITY: CommunityCatalog = { fetchedAt: null, offline: false, packs: [] }

const initial: State = {
  ready: false,
  games: [],
  settings: DEFAULT_SETTINGS,
  catalog: EMPTY_CATALOG,
  community: EMPTY_COMMUNITY,
  products: [],
  appVersion: '',
  platform: 'win32',
  dataPath: '',
  statuses: {},
  jobs: {},
  updater: { state: 'idle' },
  sharing: { sending: false },
  generate: null,
  refreshing: false,
  page: 'home',
  gameId: '',
  spokenTab: 'modules'
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'init':
      return {
        ...s,
        ready: true,
        games: a.snap.games,
        settings: a.snap.settings,
        catalog: a.snap.catalog,
        community: a.snap.community ?? EMPTY_COMMUNITY,
        products: a.snap.products,
        appVersion: a.snap.appVersion,
        platform: a.snap.platform,
        dataPath: a.snap.dataPath,
        // A state sent while the window was starting is newer than the snapshot's.
        updater: s.updater.state === 'idle' ? (a.snap.updater ?? s.updater) : s.updater,
        sharing: a.snap.sharingStatus ?? s.sharing,
        generate: a.snap.generateStatus ?? s.generate,
        statuses: a.statuses,
        page: a.page,
        gameId: a.gameId,
        spokenTab: a.tab ?? s.spokenTab
      }
    case 'fatal':
      return { ...s, ready: true, fatal: a.message }
    case 'games': {
      const keep = new Set(a.games.map((g) => g.id))
      const statuses = Object.fromEntries(Object.entries(s.statuses).filter(([id]) => keep.has(id)))
      return { ...s, games: a.games, statuses }
    }
    case 'catalog':
      return { ...s, catalog: a.catalog }
    case 'community':
      return { ...s, community: a.community }
    case 'settings':
      return { ...s, settings: a.settings }
    case 'statuses':
      return { ...s, statuses: { ...s.statuses, [a.gameId]: a.list } }
    case 'job': {
      const key = jobKey(a.job.gameId, a.job.productId)
      if (a.job.phase === 'cancelled') {
        const { [key]: _gone, ...rest } = s.jobs
        return { ...s, jobs: rest }
      }
      return { ...s, jobs: { ...s.jobs, [key]: a.job } }
    }
    case 'dismiss': {
      const { [a.key]: _gone, ...rest } = s.jobs
      return { ...s, jobs: rest }
    }
    case 'updater':
      return { ...s, updater: a.state }
    case 'sharing':
      return { ...s, sharing: a.status }
    case 'generate':
      return { ...s, generate: a.status }
    case 'refreshing':
      return { ...s, refreshing: a.on }
    case 'nav':
      return { ...s, page: a.page, gameId: a.gameId ?? s.gameId, spokenTab: a.tab ?? s.spokenTab }
  }
}

const PAGES: Page[] = ['home', 'spoken', 'voices', 'community', 'settings']

function parseHash(): { page: Page; gameId?: string; tab?: SpokenTab } {
  const [, page, gameId, tab] = location.hash.split('/')
  const found = PAGES.find((p) => p === page)
  return {
    page: found ?? 'home',
    gameId: gameId ? decodeURIComponent(gameId) : undefined,
    tab: tab === 'changelog' ? 'changelog' : tab === 'modules' ? 'modules' : undefined
  }
}

function formatHash(page: Page, gameId: string, tab: SpokenTab): string {
  if (page === 'spoken') return `#/spoken/${encodeURIComponent(gameId)}${tab === 'changelog' ? '/changelog' : ''}`
  return page === 'voices' || page === 'community' ? `#/${page}/${encodeURIComponent(gameId)}` : `#/${page}`
}

export interface Actions {
  navigate(page: Page, gameId?: string, tab?: SpokenTab): void
  selectGame(gameId: string): void
  install(gameId: string, productId: string, version?: string): Promise<void>
  uninstall(gameId: string, productId: string): Promise<void>
  /** Puts the installed version back, over what is there. */
  repair(gameId: string, productId: string): Promise<void>
  checkManagerUpdate(): Promise<void>
  cancel(jobId: string): void
  dismissJob(key: string): void
  refresh(): Promise<void>
  refreshCommunity(force?: boolean): Promise<void>
  addGame(path: string): Promise<AddGameResult>
  removeGame(gameId: string): Promise<void>
  scan(): Promise<void>
  setSettings(patch: Partial<Settings>): Promise<void>
  /** Sends the collected lines now; the result comes through `state.sharing`. */
  shareNow(): Promise<void>
}

function localError(gameId: string, productId: string, action: JobProgress['action'], message: string): JobProgress {
  return { jobId: `local-${Date.now()}`, gameId, productId, action, phase: 'error', received: 0, total: 0, bytesPerSecond: 0, message }
}

function makeActions(dispatch: Dispatch<Action>, get: () => State): Actions {
  const refetch = (gameId: string): void => {
    api()
      .statuses(gameId)
      .then((list) => dispatch({ type: 'statuses', gameId, list }))
      .catch(() => undefined)
  }
  const refetchAll = (games: GameInstall[]): void => games.forEach((g) => refetch(g.id))

  return {
    navigate: (page, gameId, tab) => dispatch({ type: 'nav', page, gameId, tab }),
    selectGame(gameId) {
      const s = get()
      dispatch({ type: 'nav', page: s.page, gameId })
      void api()
        .setSettings({ lastGameId: gameId })
        .then((settings) => dispatch({ type: 'settings', settings }))
        .catch(() => undefined)
    },
    async install(gameId, productId, version) {
      dispatch({ type: 'dismiss', key: jobKey(gameId, productId) })
      try {
        await api().install(gameId, productId, version ? { version } : undefined)
      } catch (e) {
        dispatch({ type: 'job', job: localError(gameId, productId, 'install', errorText(e)) })
      }
    },
    async repair(gameId, productId) {
      dispatch({ type: 'dismiss', key: jobKey(gameId, productId) })
      try {
        await api().install(gameId, productId, { repair: true })
      } catch (e) {
        dispatch({ type: 'job', job: localError(gameId, productId, 'repair', errorText(e)) })
      }
    },
    async checkManagerUpdate() {
      try {
        await api().checkManagerUpdate()
      } catch (e) {
        dispatch({ type: 'updater', state: { state: 'error', message: errorText(e) } })
      }
    },
    async uninstall(gameId, productId) {
      dispatch({ type: 'dismiss', key: jobKey(gameId, productId) })
      try {
        await api().uninstall(gameId, productId)
      } catch (e) {
        dispatch({ type: 'job', job: localError(gameId, productId, 'uninstall', errorText(e)) })
      }
    },
    cancel: (jobId) => void api().cancel(jobId),
    dismissJob: (key) => dispatch({ type: 'dismiss', key }),
    async refresh() {
      dispatch({ type: 'refreshing', on: true })
      try {
        const [catalog] = await Promise.all([
          api().refreshCatalog(true),
          api()
            .refreshCommunity(true)
            .then((community) => dispatch({ type: 'community', community }))
            .catch(() => dispatch({ type: 'community', community: { ...get().community, offline: true } }))
        ])
        dispatch({ type: 'catalog', catalog })
        refetchAll(get().games)
      } catch {
        dispatch({ type: 'catalog', catalog: { ...get().catalog, offline: true } })
      } finally {
        dispatch({ type: 'refreshing', on: false })
      }
    },
    async refreshCommunity(force) {
      try {
        dispatch({ type: 'community', community: await api().refreshCommunity(force) })
      } catch {
        dispatch({ type: 'community', community: { ...get().community, offline: true } })
      }
    },
    async addGame(path) {
      const result = await api().addGame(path)
      if (result.game) {
        const snap = await api().snapshot()
        dispatch({ type: 'games', games: snap.games })
        refetchAll(snap.games)
      }
      return result
    },
    async removeGame(gameId) {
      const games = await api().removeGame(gameId)
      dispatch({ type: 'games', games })
    },
    async scan() {
      const games = await api().scanGames()
      dispatch({ type: 'games', games })
      refetchAll(games)
    },
    async setSettings(patch) {
      const settings = await api().setSettings(patch)
      dispatch({ type: 'settings', settings })
      if ('includePrereleases' in patch) refetchAll(get().games)
    },
    async shareNow() {
      try {
        await api().shareNow()
      } catch (e) {
        dispatch({ type: 'sharing', status: { ...get().sharing, sending: false, error: errorText(e) } })
      }
    }
  }
}

interface Store {
  state: State
  actions: Actions
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, dispatch] = useReducer(reducer, initial)
  const ref = useRef(state)
  ref.current = state
  const actions = useMemo(() => makeActions(dispatch, () => ref.current), [])

  useEffect(() => {
    const a = api()
    let alive = true
    const refetch = (gameId: string): void => {
      a.statuses(gameId)
        .then((list) => alive && dispatch({ type: 'statuses', gameId, list }))
        .catch(() => undefined)
    }
    const refetchAll = (): void => ref.current.games.forEach((g) => refetch(g.id))

    void (async () => {
      try {
        const snap = await a.snapshot()
        const entries = await Promise.all(
          snap.games.map(async (g) => [g.id, await a.statuses(g.id).catch(() => [] as ProductStatus[])] as const)
        )
        if (!alive) return
        const route = parseHash()
        const usable = snap.games.filter((g) => isSupportedFlavor(g.flavor))
        const gameId = [route.gameId, snap.settings.lastGameId].find((id) => usable.some((g) => g.id === id)) ?? usable[0]?.id ?? snap.games[0]?.id ?? ''
        dispatch({ type: 'init', snap, statuses: Object.fromEntries(entries), page: route.page, gameId, tab: route.tab })
      } catch (e) {
        if (alive) dispatch({ type: 'fatal', message: errorText(e) })
      }
    })()

    const offs = [
      a.onJob((job) => {
        dispatch({ type: 'job', job })
        if (job.phase === 'done' || job.phase === 'error' || job.phase === 'cancelled') refetch(job.gameId)
      }),
      a.onGamesChanged((games) => {
        dispatch({ type: 'games', games })
        games.forEach((g) => refetch(g.id))
      }),
      a.onCatalogChanged((catalog) => {
        dispatch({ type: 'catalog', catalog })
        refetchAll()
      }),
      a.onCommunityChanged((community) => dispatch({ type: 'community', community })),
      a.onUpdater((u) => dispatch({ type: 'updater', state: u })),
      a.onSharing((status) => dispatch({ type: 'sharing', status })),
      a.onGenerate((status) => dispatch({ type: 'generate', status }))
    ]
    const onHash = (): void => {
      const route = parseHash()
      dispatch({ type: 'nav', page: route.page, gameId: route.gameId, tab: route.tab })
    }
    window.addEventListener('hashchange', onHash)
    return () => {
      alive = false
      offs.forEach((off) => off())
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  // Keep the address in step with the page, so a reload comes back to it.
  useEffect(() => {
    if (!state.ready) return
    const hash = formatHash(state.page, state.gameId, state.spokenTab)
    if (location.hash !== hash) location.hash = hash
  }, [state.ready, state.page, state.gameId, state.spokenTab])

  const value = useMemo(() => ({ state, actions }), [state, actions])
  return createElement(Ctx.Provider, { value }, children)
}

export function useStore(): Store {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore outside StoreProvider')
  return v
}

/** The games Spoken runs on; the others are listed on Home and in Settings only. */
export function useSupportedGames(): GameInstall[] {
  const { state } = useStore()
  return useMemo(() => state.games.filter((g) => isSupportedFlavor(g.flavor)), [state.games])
}

/** The game the Spoken, Voice packs and Community pages show: the chosen one, else the first supported. */
export function useGame(): GameInstall | undefined {
  const { state } = useStore()
  const games = useSupportedGames()
  return games.find((g) => g.id === state.gameId) ?? games[0]
}

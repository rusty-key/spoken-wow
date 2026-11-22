// The window's start-up: the first snapshot, and a catalog the main process sends while it is being shown.
import { describe, expect, it } from 'vitest'
import type { ManagerApi } from '../src/shared/api'
import { DEFAULT_SETTINGS, type CatalogUpdate, type GameInstall, type Product, type ProductStatus, type Snapshot } from '../src/shared/types'
import { connect, initial, reducer, type Action, type State } from '../src/renderer/src/store'

const GAME: GameInstall = {
  id: 'g1', root: '/wow/_forever_', addOnsPath: '/wow/_forever_/Interface/AddOns', flavorFolder: '_forever_', flavor: 'forever',
  product: 'wow_forever', label: 'WoW: Forever', source: 'auto', writable: true
}

function update(channel: string): CatalogUpdate {
  return {
    catalog: { fetchedAt: channel, offline: false, releases: {} },
    products: [{ id: `places-audio-${channel}` } as Product],
    languages: [{ code: channel, name: channel }]
  }
}

function snapshot(u: CatalogUpdate): Snapshot {
  return {
    games: [GAME], settings: DEFAULT_SETTINGS, catalog: u.catalog, community: { fetchedAt: null, offline: false, packs: [] },
    products: u.products, languages: u.languages, appVersion: '0.1.0', platform: 'linux', dataPath: '/data'
  }
}

/** An api whose first snapshot is `snap` and whose first statuses wait until released; the catalog listener is handed out. */
function fakeApi(snap: Snapshot) {
  let catalogListener: (u: CatalogUpdate) => void = () => undefined
  let release: (list: ProductStatus[]) => void = () => undefined
  let asked: () => void = () => undefined
  const statusesAsked = new Promise<void>((resolve) => (asked = resolve))
  let first = true
  const api = new Proxy({} as ManagerApi, {
    get: (_, key: string) => {
      if (key === 'snapshot') return async () => snap
      if (key === 'statuses')
        return () => {
          if (!first) return Promise.resolve([])
          first = false
          asked()
          return new Promise<ProductStatus[]>((resolve) => (release = resolve))
        }
      if (key === 'onCatalogChanged')
        return (listener: (u: CatalogUpdate) => void) => {
          catalogListener = listener
          return () => undefined
        }
      if (key.startsWith('on')) return () => () => undefined
      return async () => undefined
    }
  })
  return { api, statusesAsked, send: (u: CatalogUpdate) => catalogListener(u), release: (list: ProductStatus[]) => release(list) }
}

async function start(sendDuringStart: CatalogUpdate | null): Promise<State> {
  const fake = fakeApi(snapshot(update('A')))
  let state = initial
  let ready: () => void = () => undefined
  const done = new Promise<void>((resolve) => (ready = resolve))
  const dispatch = (a: Action): void => {
    state = reducer(state, a)
  }
  const disconnect = connect(fake.api, dispatch, { games: () => state.games, route: () => ({ page: 'voices' }), ready })
  await fake.statusesAsked
  if (sendDuringStart) fake.send(sendDuringStart)
  fake.release([])
  await done
  disconnect()
  return state
}

describe("the window's start-up", () => {
  it('keeps a catalog sent while the statuses were on their way, over the older snapshot', async () => {
    const s = await start(update('B'))
    expect(s.ready).toBe(true)
    expect(s.catalog.fetchedAt).toBe('B')
    expect(s.products.map((p) => p.id)).toEqual(['places-audio-B'])
    expect(s.languages.map((l) => l.code)).toEqual(['B'])
    expect(s.gameId).toBe('g1')
  })

  it("shows the snapshot's catalog when none was sent meanwhile", async () => {
    const s = await start(null)
    expect(s.catalog.fetchedAt).toBe('A')
    expect(s.products.map((p) => p.id)).toEqual(['places-audio-A'])
    expect(s.languages.map((l) => l.code)).toEqual(['A'])
  })
})

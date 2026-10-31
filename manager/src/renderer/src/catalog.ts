// Small readers over the snapshot: releases, statuses, flavors, languages.
import type { Catalog, Flavor, JobProgress, ProductStatus, ReleaseInfo } from '@shared/types'
import { compareVersions } from '@shared/version'
import { languageName } from '@shared/products'
import type { State } from './store'

/** The releases of a product the player may see, newest first. */
export function releasesFor(catalog: Catalog, productId: string, includePrereleases: boolean): ReleaseInfo[] {
  const list = (catalog.releases[productId] ?? []).filter((r) => includePrereleases || !r.prerelease)
  return [...list].sort((a, b) => -(compareVersions(a.version, b.version) ?? 0))
}

export function statusOf(state: State, gameId: string, productId: string): ProductStatus | undefined {
  return state.statuses[gameId]?.find((s) => s.productId === productId)
}

/** The newest release for a product on a game: the status's, else the catalog's. */
export function latestOf(state: State, gameId: string, productId: string): ReleaseInfo | undefined {
  return statusOf(state, gameId, productId)?.latest ?? releasesFor(state.catalog, productId, state.settings.includePrereleases)[0]
}

export interface FlavorLook {
  /** Plain name, for labels. */
  name: string
  /** The game's label as the manager lists it, for a game that was not found. */
  label: string
  /** CSS colours: the tint of the art, the dark end and the glow of the wordmark. */
  from: string
  to: string
  glow: string
}

const LOOKS: Record<Flavor, FlavorLook> = {
  forever: { name: 'Forever', label: 'WoW: Forever', from: '#1d6f8f', to: '#0b2a3a', glow: '#f0c25a' },
  classic_era: { name: 'Classic Era', label: 'WoW: Classic Era', from: '#9a5a1c', to: '#33200f', glow: '#f2b04a' },
  anniversary: { name: 'Anniversary', label: 'WoW: Anniversary', from: '#a23a58', to: '#2e1020', glow: '#f4bb78' }
}

export const flavorLook = (flavor: Flavor): FlavorLook => LOOKS[flavor]

const TAGS: Record<string, string> = {
  enUS: 'EN',
  deDE: 'DE',
  esES: 'ES',
  esMX: 'MX',
  frFR: 'FR',
  itIT: 'IT',
  ptBR: 'PT',
  ruRU: 'RU',
  koKR: 'KO',
  zhCN: 'ZH-CN',
  zhTW: 'ZH-TW'
}

export const langTag = (code: string): string => TAGS[code] ?? code.toUpperCase()
export { languageName }

type ActiveJob = JobProgress & { phase: 'queued' | 'downloading' | 'verifying' | 'extracting' | 'installing' }

/** A job that is still going: it takes the place of a button. */
export function jobBusy(job: JobProgress | undefined): job is ActiveJob {
  return !!job && job.phase !== 'done' && job.phase !== 'error' && job.phase !== 'cancelled'
}

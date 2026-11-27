import { BASE_LANGUAGE } from '@shared/products'
import type { Product, ProductStatus, Settings } from '@shared/types'

/** Change the id to show a new announcement to players who closed the last one. */
export const ANNOUNCEMENT_ID = 'listen-2026-11'
export const LISTEN_URL = 'https://spoken.quest/listen'

/**
 * The upcoming voices are English. A player with voice packs installed sees it when one of them is English;
 * the Voice Packs page's language is English for everyone who never changed it, so it decides only when no
 * pack is installed.
 */
export function showsAnnouncement(settings: Settings, products: readonly Product[], statuses: Record<string, ProductStatus[]>): boolean {
  if (settings.dismissedAnnouncement === ANNOUNCEMENT_ID) return false
  const langOf = new Map(products.filter((p) => p.kind === 'voices').map((p) => [p.id, p.lang]))
  const installed = Object.values(statuses)
    .flat()
    .filter((st) => st.state !== 'not-installed' && langOf.has(st.productId))
    .map((st) => langOf.get(st.productId))
  if (installed.length > 0) return installed.includes(BASE_LANGUAGE)
  return (settings.voiceLanguage || BASE_LANGUAGE) === BASE_LANGUAGE
}

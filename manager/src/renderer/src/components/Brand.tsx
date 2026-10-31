import type { CSSProperties, ReactNode } from 'react'
import type { Flavor } from '@shared/types'
import { flavorLook } from '../catalog'
import { S } from '../strings'
import artAnniversary from '../assets/games/art-anniversary.jpg'
import artEra from '../assets/games/art-era.jpg'
import artForever from '../assets/games/art-forever.jpg'
import iconAnniversary from '../assets/games/icon-anniversary.png'
import iconEra from '../assets/games/icon-era.png'
import iconForever from '../assets/games/icon-forever.png'
import logoAnniversary from '../assets/games/logo-anniversary.png'
import logoEra from '../assets/games/logo-era.png'
import logoForever from '../assets/games/logo-forever.png'

// The games' own logos, key art and icons, from warcraft.wiki.gg (see manager/CREDITS.md).
// `pos` is where the art is anchored in its box, `filter` how far it is darkened.
interface GameImages {
  logo: string
  art: string
  icon: string
  pos: string
  filter: string
}

const IMAGES: Record<Flavor, GameImages> = {
  forever: { logo: logoForever, art: artForever, icon: iconForever, pos: '34% 30%', filter: 'brightness(0.55) saturate(0.8)' },
  classic_era: { logo: logoEra, art: artEra, icon: iconEra, pos: '12% 22%', filter: 'brightness(0.85)' },
  anniversary: { logo: logoAnniversary, art: artAnniversary, icon: iconAnniversary, pos: '26% 40%', filter: 'brightness(0.8)' }
}

function look(flavor: Flavor): CSSProperties {
  const l = flavorLook(flavor)
  const img = IMAGES[flavor]
  return { '--g-from': l.from, '--g-to': l.to, '--g-glow': l.glow, '--g-art': `url(${img.art})`, '--g-pos': img.pos, '--g-filter': img.filter } as CSSProperties
}

/** The game's logo; on the rail of a page it has the small SPOKEN word over it. */
export function Wordmark({ flavor, kicker = false }: { flavor: Flavor; kicker?: boolean }): ReactNode {
  return (
    <div className="wordmark" style={look(flavor)}>
      {kicker && (
        <span className="wm-kicker" aria-hidden="true">
          {S.tabs.spoken}
        </span>
      )}
      <img className="wm-logo" src={IMAGES[flavor].logo} alt={`${S.tabs.spoken} ${flavorLook(flavor).name}`} />
    </div>
  )
}

/** The small icon of a game in the strip and in the settings rows. */
export function GameIcon({ flavor }: { flavor: Flavor }): ReactNode {
  return (
    <span className="game-icon" aria-hidden="true">
      <img src={IMAGES[flavor].icon} alt="" width={30} height={30} />
    </span>
  )
}

/** The picture of a game card: the key art, with the game's logo over it. */
export function CardArt({ flavor }: { flavor: Flavor }): ReactNode {
  return (
    <div className="card-art" style={look(flavor)}>
      <div className="card-art-img" />
      <Wordmark flavor={flavor} />
    </div>
  )
}

/** A wide strip of key art for the hero card, fading into the panel on its right. */
export function HeroArt({ flavor }: { flavor: Flavor }): ReactNode {
  return (
    <div className="hero-art" style={look(flavor)} aria-hidden="true">
      <div className="hero-art-img" />
      <img className="wm-logo" src={IMAGES[flavor].logo} alt="" />
    </div>
  )
}

/** The key art behind a page: large at the left, fading into the page colour toward the right and the bottom. */
export function Backdrop({ flavor, compact = false }: { flavor: Flavor; compact?: boolean }): ReactNode {
  return (
    <div className={`backdrop${compact ? ' backdrop-compact' : ''}`} style={look(flavor)} aria-hidden="true">
      <div className="backdrop-art" />
      <div className="backdrop-glow" />
    </div>
  )
}

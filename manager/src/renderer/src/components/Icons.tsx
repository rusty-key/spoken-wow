import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

function make(children: ReactNode, fill = false) {
  return function Icon({ size = 18, className }: IconProps): ReactNode {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? 'currentColor' : 'none'}
        stroke={fill ? 'none' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={className}
      >
        {children}
      </svg>
    )
  }
}

/** Window buttons: thin 10px glyphs like Windows', drawn on their own grid. */
function windowGlyph(children: ReactNode) {
  return function Glyph(): ReactNode {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true" focusable="false">
        {children}
      </svg>
    )
  }
}

export const IconWinMinimize = windowGlyph(<path d="M0 5.5h10" />)
export const IconWinMaximize = windowGlyph(<rect x="0.5" y="0.5" width="9" height="9" />)
export const IconWinRestore = windowGlyph(
  <>
    <rect x="0.5" y="2.5" width="7" height="7" />
    <path d="M2.5 2.5v-2h7v7h-2" />
  </>
)
export const IconWinClose = windowGlyph(<path d="M0 0l10 10M10 0L0 10" />)

export const IconRefresh = make(
  <>
    <path d="M20 11a8 8 0 0 0-14.3-4.5L4 8.5" />
    <path d="M4 4v4.5h4.5" />
    <path d="M4 13a8 8 0 0 0 14.3 4.5l1.7-2" />
    <path d="M20 20v-4.5h-4.5" />
  </>
)

export const IconGear = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>
)

export const IconFolder = make(<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />)
export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7.5" />)
export const IconAlert = make(
  <>
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5" />
    <path d="M12 17.6v.1" />
  </>
)
export const IconDownload = make(
  <>
    <path d="M12 4v11" />
    <path d="M7 11l5 5 5-5" />
    <path d="M5 20h14" />
  </>
)
export const IconX = make(
  <>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </>
)
export const IconChevron = make(<path d="M6 9l6 6 6-6" />)
export const IconExternal = make(
  <>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </>
)
export const IconPlus = make(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>
)
export const IconLink = make(
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </>
)
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <path d="M12 7.6v.1" />
  </>
)
export const IconHeart = make(<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />)
export const IconUser = make(<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0" />)
export const IconPlay = make(<path d="M8 5.5v13l11-6.5z" />, true)
export const IconChevronRight = make(<path d="M9 6l6 6-6 6" />)
export const IconGames = make(
  <>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M10 9.5v5l4-2.5z" />
  </>
)

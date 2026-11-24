// How the window's frame differs per platform. No electron imports, so it can be tested.

export interface WindowChrome {
  titleBarStyle: 'hidden' | 'hiddenInset'
  /** false: no system frame at all. Set on Linux so a desktop frame is never drawn next to the page's own buttons. */
  frame?: boolean
  /** macOS only: where the system's red, yellow and green buttons sit: in a strip above the page's tabs. */
  trafficLightPosition?: { x: number; y: number }
  /** Whether the page draws its own minimize, maximize and close buttons. */
  pageDrawsButtons: boolean
}

/**
 * Windows and Linux: no system frame, the page draws the buttons. macOS: the system's three
 * buttons stay, in the top-left corner above the page's tabs, and the page hides its own.
 */
export function windowChrome(platform: NodeJS.Platform): WindowChrome {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 8 }, pageDrawsButtons: false }
  }
  if (platform === 'linux') return { titleBarStyle: 'hidden', frame: false, pageDrawsButtons: true }
  return { titleBarStyle: 'hidden', pageDrawsButtons: true }
}

// Which page may talk to the main process and which navigations are allowed. No electron imports, so it can be tested.
import { fileURLToPath, pathToFileURL } from 'node:url'
import { samePath } from './guard'

export interface AppPage {
  /** The dev server's address in development, else empty. */
  devUrl?: string | undefined
  /** The built `index.html`. */
  indexHtml: string
}

/** The file URL of the built page. */
export function pageFileUrl(indexHtml: string): string {
  return pathToFileURL(indexHtml).href
}

/**
 * True for the window's own page and nothing else: in development the dev server's origin, in the
 * built app exactly the `index.html` file (a hash or query is ignored; any other file is not ours).
 */
export function isOurPage(url: unknown, page: AppPage, platform: NodeJS.Platform = process.platform): boolean {
  if (typeof url !== 'string' || url === '') return false
  if (page.devUrl) {
    try {
      return new URL(url).origin === new URL(page.devUrl).origin
    } catch {
      return false
    }
  }
  if (!url.startsWith('file:')) return false
  try {
    const u = new URL(url)
    if (u.host !== '') return false
    return samePath(fileURLToPath(`${u.protocol}//${u.pathname}`), page.indexHtml, platform)
  } catch {
    return false
  }
}

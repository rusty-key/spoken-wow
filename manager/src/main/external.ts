// What the window may ask the main process to open. No electron imports, so it can be tested.
import fs from 'node:fs'
import path from 'node:path'
import { isInside } from './guard'

const EXTERNAL_HOSTS = new Set(['github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'spoken.rusty.one'])

/** Only plain https links to GitHub's own hosts and the site's: no other scheme, no credentials, no odd port. */
export function isAllowedExternalUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return false
  }
  return u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname) && u.username === '' && u.password === '' && (u.port === '' || u.port === '443')
}

/** A path inside one of the folders the window may open in Explorer. */
export function isAllowedOpenPath(value: unknown, roots: readonly string[]): boolean {
  if (typeof value !== 'string' || value === '' || value.includes('\0') || value.length > 2048) return false
  if (!path.isAbsolute(value)) return false
  return roots.some((r) => r !== '' && isInside(r, value))
}

// Folders macOS opens as a program or plug-in instead of showing them in Finder.
const MAC_BUNDLE = /\.(app|appex|bundle|framework|kext|mdimporter|plugin|prefpane|qlgenerator|saver|xpc)$/i

/**
 * The folder to open in Explorer: inside one of `roots`, and a directory. A file is never opened
 * (the shell would run it), and neither is a link to one. On macOS an app is a folder too, so a
 * bundle is refused as well.
 */
export async function openableDirectory(value: unknown, roots: readonly string[], platform: NodeJS.Platform = process.platform): Promise<string> {
  if (!isAllowedOpenPath(value, roots)) throw new Error('That folder cannot be opened from here')
  const target = path.resolve(value as string)
  let st: fs.Stats
  try {
    st = await fs.promises.stat(target)
  } catch {
    throw new Error('That folder does not exist')
  }
  if (!st.isDirectory()) throw new Error('Only folders can be opened from here')
  if (platform === 'darwin' && MAC_BUNDLE.test(path.basename(await fs.promises.realpath(target)))) {
    throw new Error('Only folders can be opened from here')
  }
  return target
}

// No undici here: this runs on every settings load, and undici is loaded only once a proxy is set.
import { PlainError } from './errors'
import { t } from './i18n'

/**
 * Chromium's and undici's common ground. SOCKS4 and SOCKS4a are left out because Chromium cannot do v4a.
 * `https:` is left out because undici would connect to the proxy in the clear: it only wraps that hop in TLS
 * when it is given `proxyTls`, which a `ProxyAgent` made from the address alone does not have.
 */
const SCHEMES = ['http:', 'socks5:']
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * The address to use, or '' for the system's. A bare `host:port` means HTTP, spelled out so Chromium's reading
 * and undici's cannot drift apart. Credentials are refused because Chromium ignores them rather than failing.
 */
export function normalizeProxy(setting: string): string {
  const s = setting.trim()
  if (!s) return ''
  let url: URL
  try {
    // A URL needs a scheme, and `127.0.0.1:10808` parses as one called "127.0.0.1".
    url = new URL(HAS_SCHEME.test(s) ? s : `http://${s}`)
  } catch {
    throw new PlainError(t('proxy.invalid'))
  }
  // The URL parser drops a default port (`http://p:80` has none), so it is read back from the authority, never
  // from a path or query that happens to end in a number.
  const authority = s.replace(HAS_SCHEME, '').split(/[/?#]/)[0] ?? ''
  const port = url.port || /:(\d+)$/.exec(authority)?.[1] || ''
  // `socks5h` is Firefox's spelling, which neither stack accepts. Bare `socks` is SOCKS4 to Chromium and SOCKS5
  // to undici, so left alone the two would speak different protocols to the same proxy.
  if (url.protocol === 'socks5h:' || url.protocol === 'socks:') url.protocol = 'socks5:'
  // Chromium reads `proxyRules` as a `;`-separated list, and the parser leaves a `;` in a hostname alone, so
  // `socks5://a;direct:1080` would become two rules.
  const badHost = !/^[A-Za-z0-9._:[\]-]+$/.test(url.hostname)
  if (badHost || url.username || url.password || !port || port === '0' || !SCHEMES.includes(url.protocol)) {
    throw new PlainError(t('proxy.invalid'))
  }
  return `${url.protocol}//${url.hostname}:${port}`
}

/** What Chromium is given for a saved (normalized) address: everything through it but the machine itself. */
export function proxyConfig(uri: string): Electron.ProxyConfig | null {
  return uri ? { mode: 'fixed_servers', proxyRules: uri, proxyBypassRules: '<local>' } : null
}

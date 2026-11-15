// The proxy address in the one form both network stacks read, kept free of undici so `state.ts` can
// normalize on load without it.
import { PlainError } from './errors'
import { t } from './i18n'

/**
 * Chromium's and undici's common ground. SOCKS4 and SOCKS4a are left out because Chromium cannot do v4a.
 * `https:` is left out because undici would connect to the proxy in the clear: it only wraps that hop in TLS
 * when it is given `proxyTls`, which a `ProxyAgent` made from the address alone does not have. `socks:` stays:
 * both read it as SOCKS5.
 */
const SCHEMES = ['http:', 'socks:', 'socks5:']

/**
 * The address to use, or '' for the system's. A bare `host:port` means HTTP, which is what a proxy URL
 * without a scheme has always meant outside a browser; saying so here keeps Chromium's reading of it and
 * undici's from drifting apart. `socks5h` is Firefox's spelling of what both call `socks5`, and neither
 * stack here accepts it. Credentials are refused because Chromium ignores them rather than failing.
 */
export function normalizeProxy(setting: string): string {
  const s = setting.trim()
  if (!s) return ''
  let url: URL
  try {
    // A URL needs a scheme, and `127.0.0.1:10808` parses as one called "127.0.0.1".
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`)
  } catch {
    throw new PlainError(t('proxy.invalid'))
  }
  // The URL parser drops a port that matches the scheme's default, so `http://p:80` arrives with no port at
  // all. A proxy on 80 or 443 is still a port the player wrote, so it is read back from the authority: not
  // from the whole text, where a path or a query can end in a number that is not a port.
  const authority = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0] ?? ''
  const port = url.port || /:(\d+)$/.exec(authority)?.[1] || ''
  if (url.protocol === 'socks5h:') url.protocol = 'socks5:'
  // Chromium reads `proxyRules` as a `;`-separated list, and the parser leaves a `;` in a hostname alone, so
  // `socks5://a;direct:1080` would become two rules. Nothing else in a host needs rejecting.
  if (!/^[A-Za-z0-9._:[\]-]+$/.test(url.hostname)) throw new PlainError(t('proxy.invalid'))
  if (url.username || url.password || !port || port === '0' || !SCHEMES.includes(url.protocol)) throw new PlainError(t('proxy.invalid'))
  return `${url.protocol}//${url.hostname}:${port}`
}

/** What Chromium is given: every request through this proxy but the ones to the machine itself. */
export function proxyConfig(setting: string): Electron.ProxyConfig | null {
  const uri = normalizeProxy(setting)
  return uri ? { mode: 'fixed_servers', proxyRules: uri, proxyBypassRules: '<local>' } : null
}

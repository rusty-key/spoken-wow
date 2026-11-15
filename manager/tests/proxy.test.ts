import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/types'
import { normalizeProxy, proxyConfig } from '../src/main/proxy'
import { dispatcherFor } from '../src/main/proxy-agent'
import { loadSettings, sanitizeSettings, saveSettings } from '../src/main/state'
import { tmpDir } from './helpers'

describe('the proxy setting', () => {
  it('keeps the address both network stacks can use, and spells the shorthand out', () => {
    expect(normalizeProxy('')).toBe('')
    expect(normalizeProxy('   ')).toBe('')
    expect(normalizeProxy('socks5://127.0.0.1:10808')).toBe('socks5://127.0.0.1:10808')
    expect(normalizeProxy('http://127.0.0.1:10808')).toBe('http://127.0.0.1:10808')
    // A bare address has always meant an HTTP proxy; both stacks are told so here rather than guessing.
    expect(normalizeProxy('127.0.0.1:10808')).toBe('http://127.0.0.1:10808')
    // `socks5h` is Firefox's name for it, and undici refuses the address outright.
    expect(normalizeProxy('socks5h://127.0.0.1:10808')).toBe('socks5://127.0.0.1:10808')
    expect(normalizeProxy('SOCKS5://127.0.0.1:10808')).toBe('socks5://127.0.0.1:10808')
    expect(normalizeProxy('  http://proxy.example:8080  ')).toBe('http://proxy.example:8080')
  })

  it('keeps a port the URL parser would have dropped, and stays put when normalized again', () => {
    // A port equal to the scheme's default is not part of `url.port`, so it is read back from the text.
    for (const [given, want] of [
      ['http://proxy.example:80', 'http://proxy.example:80'],
      ['proxy.example:80', 'http://proxy.example:80'],
      ['socks5://proxy.example:1080', 'socks5://proxy.example:1080'],
      ['http://proxy.example:80/', 'http://proxy.example:80']
    ] as const) {
      expect(normalizeProxy(given)).toBe(want)
      expect(normalizeProxy(want)).toBe(want)
    }
  })

  it('reads the port from the authority, not from the end of a path or a query', () => {
    // Without this the trailing number would become the proxy's port, and the window would then show it.
    expect(normalizeProxy('http://proxy.example:80/path:9000')).toBe('http://proxy.example:80')
    expect(normalizeProxy('http://proxy.example:80/?h=:3128')).toBe('http://proxy.example:80')
    expect(normalizeProxy('http://proxy.example:80#x:1')).toBe('http://proxy.example:80')
    // An address with no port of its own is refused, even when its path ends in something port-shaped: taking
    // that as the port would store a value the URL parser rejects on the next load.
    expect(() => normalizeProxy('http://proxy.example/path:99999')).toThrow()
  })

  it('refuses what one of the two stacks cannot use', () => {
    // Chromium cannot do SOCKS4a at all, and a half-applied proxy is worse than a refused one.
    expect(() => normalizeProxy('socks4://127.0.0.1:10808')).toThrow()
    // Chromium ignores credentials in the proxy rules rather than failing, so the two would disagree.
    expect(() => normalizeProxy('socks5://user:pass@127.0.0.1:10808')).toThrow()
    expect(() => normalizeProxy('file:///etc/passwd')).toThrow()
    expect(() => normalizeProxy('127.0.0.1')).toThrow()
    expect(() => normalizeProxy('nonsense://host:1')).toThrow()
    // Chromium could reach an https:// proxy, but undici connects to that hop in the clear without `proxyTls`,
    // so half the manager would work and half would not.
    expect(() => normalizeProxy('https://proxy.example:8443')).toThrow()
    // Chromium reads the rules as a `;`-separated list, and a `;` survives the URL parser inside a hostname.
    expect(() => normalizeProxy('socks5://a;direct:1080')).toThrow()
  })

  it('turns the address into the chromium proxy config, leaving the machine itself out', () => {
    expect(proxyConfig('')).toBeNull()
    expect(proxyConfig('socks5://127.0.0.1:10808')).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'socks5://127.0.0.1:10808',
      proxyBypassRules: '<local>'
    })
  })

  it('has a dispatcher only while there is a proxy', () => {
    expect(dispatcherFor('')).toBeNull()
    expect(dispatcherFor('http://127.0.0.1:10808')).not.toBeNull()
  })

  it('survives a restart, and is written down in the form both stacks read', () => {
    expect(sanitizeSettings({ proxy: 'socks5://127.0.0.1:10808' }).proxy).toBe('socks5://127.0.0.1:10808')
    expect(sanitizeSettings({}).proxy).toBe('')
  })

  it('normalizes what was loaded, and drops an address neither stack can use', () => {
    const dir = tmpDir()
    saveSettings(dir, { ...DEFAULT_SETTINGS, proxy: 'socks5h://127.0.0.1:10808' })
    // A hand-edited file must not leave the window showing one address while another is in use.
    expect(loadSettings(dir).proxy).toBe('socks5://127.0.0.1:10808')

    saveSettings(dir, { ...DEFAULT_SETTINGS, proxy: 'socks4://127.0.0.1:10808' })
    expect(loadSettings(dir).proxy).toBe('')
  })
})

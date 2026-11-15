// Node's side of the proxy setting: the dispatcher that carries the site's and the stores' requests.
import { ProxyAgent } from 'undici'
import { normalizeProxy } from './proxy'

let current: { uri: string; agent: ProxyAgent } | null = null

/**
 * The dispatcher for this setting, or null to go direct. A new address closes the old agent, whose pooled
 * sockets would otherwise keep using the proxy that is no longer wanted.
 */
export function dispatcherFor(setting: string): ProxyAgent | null {
  const uri = normalizeProxy(setting)
  if (!uri) {
    if (current) void closeDispatcher()
    return null
  }
  if (current?.uri === uri) return current.agent
  const stale = current
  const agent = new ProxyAgent(uri)
  current = { uri, agent }
  // Closed after the new one is in place: the other way round, a request arriving in between would find the
  // old agent still current and use a proxy that is on its way out.
  if (stale) void stale.agent.close().catch(() => undefined)
  return agent
}

export async function closeDispatcher(): Promise<void> {
  const old = current
  current = null
  if (old) await old.agent.close().catch(() => undefined)
}

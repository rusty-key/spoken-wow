import type { ProxyAgent } from 'undici'

type Undici = typeof import('undici')

// Loaded on first use: most players set no proxy, and requiring undici would slow every start-up.
let undici: Promise<Undici> | null = null
let current: { uri: string; agent: ProxyAgent } | null = null

/**
 * undici's own fetch and an agent for this address (already normalized), or null to go direct. The fetch is
 * undici's because its ProxyAgent is not guaranteed to work under the different undici copy in Electron's
 * Node. A new address closes the old agent, whose pooled sockets would keep using the old proxy.
 */
export async function proxyRoute(uri: string): Promise<{ fetch: Undici['fetch']; agent: ProxyAgent } | null> {
  if (!uri) {
    void current?.agent.close().catch(() => undefined)
    current = null
    return null
  }
  const u = await (undici ??= import('undici'))
  if (current?.uri !== uri) {
    const stale = current
    current = { uri, agent: new u.ProxyAgent(uri) }
    void stale?.agent.close().catch(() => undefined)
  }
  return { fetch: u.fetch, agent: current.agent }
}

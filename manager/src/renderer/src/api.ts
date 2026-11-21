import type { ManagerApi } from '@shared/api'

let current: ManagerApi | null = null

/** The preload's api, or the fake one when the page runs in a plain browser. */
export async function loadApi(): Promise<ManagerApi> {
  if (current) return current
  if (window.manager) {
    current = window.manager
  } else {
    const { createMockApi } = await import('./mock/api')
    current = createMockApi()
  }
  return current
}

export function api(): ManagerApi {
  if (!current) throw new Error('The manager api is not loaded yet')
  return current
}

/** The text of an error from the main process, without Electron's "Error invoking remote method" prefix. */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

// Errors whose message is written for the player. Anything else is logged and shown generically.

/** An expected failure. `message` is plain words and safe to show in the window. */
export class PlainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlainError'
  }
}

/** The player pressed Cancel. */
export class CancelledError extends Error {
  constructor(message = 'Cancelled.') {
    super(message)
    this.name = 'AbortError'
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err instanceof CancelledError)
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancelledError()
}

/** Aborts at `signal` or after `ms`. A timeout rejects with a TimeoutError, so it never reads as a cancel. */
export function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** The message to show for any thrown value. */
export function plainMessage(err: unknown): string {
  if (err instanceof PlainError) return err.message
  if (isAbortError(err)) return 'Cancelled.'
  const text = err instanceof Error ? err.message : String(err)
  return `Something went wrong: ${text}`
}

export function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new CancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** A translation may leave internal fields (folder names and aliases) inherited from English. */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepPartial<U>[]
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T

function merge(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base
  if (!base || typeof base !== 'object' || Array.isArray(base)) return patch
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) out[key] = merge(out[key], value)
  return out
}

export function translated<T>(base: T, patch: DeepPartial<T>): T {
  return merge(base, patch) as T
}

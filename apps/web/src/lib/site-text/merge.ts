/** `over` laid over `base`: whatever `over` lacks, or has the wrong kind of, stays as `base` has it. Arrays keep English's length. */
export function merge<T>(base: T, over: unknown): T {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base)) return (Array.isArray(over) ? base.map((item, i) => merge(item, over[i])) : base) as T;
  if (typeof base === "object" && base !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(base)) out[key] = merge((base as Record<string, unknown>)[key], (over as Record<string, unknown>)[key]);
    return out as T;
  }
  return (typeof over === typeof base ? over : base) as T;
}

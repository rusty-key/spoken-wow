// Versions as the project writes them: `3.5.0`, `2.1.1`, `3.5.0-alpha.1`, `0.0.5`.

interface Parsed {
  core: number[]
  pre: (string | number)[]
}

function parse(v: string): Parsed | null {
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim())
  if (!m) return null
  const pre = m[2] ? m[2].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : []
  return { core: m[1]!.split('.').map(Number), pre }
}

/** Negative when a < b, zero when equal, positive when a > b; null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return null
  const n = Math.max(x.core.length, y.core.length)
  for (let i = 0; i < n; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0)
    if (d !== 0) return d
  }
  // A release outranks its own pre-release.
  if (x.pre.length === 0 && y.pre.length === 0) return 0
  if (x.pre.length === 0) return 1
  if (y.pre.length === 0) return -1
  const m = Math.max(x.pre.length, y.pre.length)
  for (let i = 0; i < m; i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    if (typeof p === 'number' && typeof q === 'number') return p - q
    if (typeof p === 'number') return -1
    if (typeof q === 'number') return 1
    return p < q ? -1 : 1
  }
  return 0
}

export function isPrerelease(v: string): boolean {
  const p = parse(v)
  return !!p && p.pre.length > 0
}

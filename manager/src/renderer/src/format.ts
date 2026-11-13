import { localeTag } from './locale'

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB'
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`
  if (n >= MB) return `${n >= 100 * MB ? Math.round(n / MB) : (n / MB).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / KB))} KB`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

/** In the window's language, not the system's. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(localeTag(), { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' })
}

/** The dictionary supplies a word per plural category; `Intl` picks the one the language's rule wants. */
export function pluralForm(n: number, forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }): string {
  const rule = new Intl.PluralRules(localeTag()).select(n)
  return forms[rule] ?? forms.other
}

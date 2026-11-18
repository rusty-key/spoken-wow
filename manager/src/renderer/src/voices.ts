// Who made a language's voice packs, and which of them the Voice Packs page shows and Install All installs.
import { ALL_AUTHORS, PAGE_AUTHOR, type Product } from '@shared/types'

export { ALL_AUTHORS, PAGE_AUTHOR }

export interface Author {
  /** The team's slug, or PAGE_AUTHOR. */
  key: string
  /** Empty for PAGE_AUTHOR: the window names it. */
  name: string
  official: boolean
}

export interface Authors {
  /** Official first, then by name. */
  list: Author[]
  keyOf: (p: Product) => string
}

/**
 * The authors of a language's products. A page pack has no team, but its language's privileged team made it: with
 * one named official team in the language, page packs are that team's, so one team is not two authors.
 */
export function authorsOf(products: readonly Product[]): Authors {
  const named = new Map<string, Author>()
  for (const p of products) if (p.team) named.set(p.team.slug, { key: p.team.slug, name: p.team.name, official: p.team.official })
  const official = [...named.values()].filter((a) => a.official)
  const pageKey = official.length === 1 ? official[0]!.key : PAGE_AUTHOR
  const keyOf = (p: Product): string => p.team?.slug ?? pageKey
  const list = [...new Set(products.map(keyOf))].map((key) => named.get(key) ?? { key, name: '', official: true })
  list.sort((a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name))
  return { list, keyOf }
}

/** The saved choice, or All when it names no author the language has now. */
export function chosenAuthor(saved: string | undefined, authors: Authors): string {
  return authors.list.length > 1 && saved !== undefined && authors.list.some((a) => a.key === saved) ? saved : ALL_AUTHORS
}

/** A section's rows, one group per author in the authors' order. */
export function groupByAuthor(rows: readonly Product[], authors: Authors): { author: Author; rows: Product[] }[] {
  return authors.list.map((author) => ({ author, rows: rows.filter((p) => authors.keyOf(p) === author.key) })).filter((g) => g.rows.length > 0)
}

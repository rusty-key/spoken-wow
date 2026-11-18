// Who made a language's voice packs, and which of them the Voice Packs page shows and Install All installs.
import { PAGE_PACKS } from '@shared/products'
import { ALL_AUTHORS, PAGE_AUTHOR, SECTIONS, type PackAuthor, type Product, type Section } from '@shared/types'

export { ALL_AUTHORS, PAGE_AUTHOR }

/** A null name is PAGE_AUTHOR's: the window names it. */
export type Author = PackAuthor

export interface Authors {
  /** Official first, then by name. */
  list: Author[]
  keyOf: (p: Product) => string
}

const authorOf = (p: Product): Author => p.author ?? PAGE_PACKS

/** The authors of a language's products, as shared/products.ts resolved each product's. */
export function authorsOf(products: readonly Product[]): Authors {
  const byKey = new Map<string, Author>()
  for (const p of products) {
    const a = authorOf(p)
    if (!byKey.has(a.key)) byKey.set(a.key, a)
  }
  const list = [...byKey.values()].sort((a, b) => Number(b.official) - Number(a.official) || (a.name ?? '').localeCompare(b.name ?? ''))
  return { list, keyOf: (p) => authorOf(p).key }
}

/** The saved choice, or All when it names no author the language has now. */
export function chosenAuthor(saved: string | undefined, authors: Authors): string {
  return authors.list.length > 1 && saved !== undefined && authors.list.some((a) => a.key === saved) ? saved : ALL_AUTHORS
}

/** A section's rows, one group per author in the authors' order. */
export function groupByAuthor(rows: readonly Product[], authors: Authors): { author: Author; rows: Product[] }[] {
  return authors.list.map((author) => ({ author, rows: rows.filter((p) => authors.keyOf(p) === author.key) })).filter((g) => g.rows.length > 0)
}

/** An author's packs of one section to install: the quests bundle in place of its sides when there is one. */
function packsOf(released: readonly Product[], authors: Authors, key: string, section: Section): Product[] {
  const own = released.filter((p) => p.section === section && authors.keyOf(p) === key)
  const bundle = own.filter((p) => p.pack === 'all')
  return section === 'quests' && bundle.length > 0 ? bundle : own
}

export type InstallAllPlan = { kind: 'install'; products: Product[] } | { kind: 'ask'; authors: Author[] }

/**
 * What Install All installs. With one author chosen, or only one, that author's. With All and several, the official
 * authors' where the language has them, the first that has each section; with none official it asks whose. One press
 * never installs two authors' packs of one section, which would play over each other.
 */
export function installAllPlan(released: readonly Product[], authors: Authors, choice: string, needed: (p: Product) => boolean): InstallAllPlan {
  const pick = (author: (section: Section) => string | undefined): Product[] =>
    SECTIONS.flatMap((section) => {
      const key = author(section)
      return key === undefined ? [] : packsOf(released, authors, key, section)
    }).filter(needed)
  if (choice !== ALL_AUTHORS) return { kind: 'install', products: pick(() => choice) }
  if (authors.list.length <= 1) return { kind: 'install', products: pick(() => authors.list[0]?.key) }
  const official = authors.list.filter((a) => a.official)
  if (official.length === 0) return { kind: 'ask', authors: authors.list }
  return { kind: 'install', products: pick((section) => official.find((a) => packsOf(released, authors, a.key, section).length > 0)?.key) }
}

/** Whether Install All has anything to do; for a question, whether any answer would install something. */
export function installAllHasWork(plan: InstallAllPlan, released: readonly Product[], authors: Authors, needed: (p: Product) => boolean): boolean {
  if (plan.kind === 'install') return plan.products.length > 0
  return plan.authors.some((a) => {
    const answer = installAllPlan(released, authors, a.key, needed)
    return answer.kind === 'install' && answer.products.length > 0
  })
}

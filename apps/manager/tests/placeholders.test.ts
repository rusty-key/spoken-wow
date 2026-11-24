import { describe, expect, it } from 'vitest'
import { S_EN } from '../src/renderer/src/strings.en'
import { DICTS } from '../src/renderer/src/strings'

/** The plural helper and its categories word the sentence; they are not values it shows. */
const NOT_VALUES = new Set(['pluralForm', 'forms', 'zero', 'one', 'two', 'few', 'many', 'other'])

/**
 * Read from the source, not called: `Intl.PluralRules` throws on a stand-in argument and would hide
 * every name after it. Only the interpolated names are compared, not the words around them.
 */
function shapes(fn: (...args: unknown[]) => unknown): string {
  const source = fn.toString()
  const found: string[] = []
  for (const m of source.matchAll(/\$\{([^}]*)\}/g)) {
    let expr = m[1]!
    // Drop the plural helper and everything it is called with: it words the sentence, it is not
    // something the player reads, and Chinese needs no such call.
    expr = expr.replace(/\(0,\s*[\w$.]*pluralForm\)\s*\([^)]*\)/g, '').replace(/\bpluralForm\s*\([^)]*\)/g, '')
    // Drop string literals: their braces belong to the wording, not to a placeholder.
    expr = expr.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '')
    // What is left names the values the sentence shows.
    for (const id of expr.matchAll(/\b[a-zA-Z_$][\w$]*\b/g)) {
      const word = id[0]
      if (NOT_VALUES.has(word)) continue
      // Bundler artifacts (`__vite_ssr_import_1__`) are not values the sentence shows.
      if (word.startsWith('_')) continue
      if (!found.includes(word)) found.push(word)
    }
  }
  return found.sort().join('|')
}

/** Every `{word}` a plain string holds. */
function names(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
}

function walk(en: unknown, other: unknown, path: string, out: string[], language = 'translation'): void {
  if (typeof en === 'function' && typeof other === 'function') {
    const a = shapes(en as (...args: unknown[]) => unknown)
    const b = shapes(other as (...args: unknown[]) => unknown)
    if (a !== b) out.push(`${path}: English fills [${a}] / ${language} fills [${b}]`)
    return
  }
  if (typeof en === 'string' && typeof other === 'string') {
    const a = names(en).join(',')
    const b = names(other).join(',')
    if (a !== b) out.push(`${path}: English has {${a}}, ${language} has {${b}}`)
    return
  }
  if (en && other && typeof en === 'object' && typeof other === 'object') {
    for (const key of Object.keys(en)) {
      walk((en as Record<string, unknown>)[key], (other as Record<string, unknown>)[key], path ? `${path}.${key}` : key, out, language)
    }
  }
}

describe('a placeholder is never left unfilled', () => {
  it('both languages fill the same names, in plain strings and in built sentences', () => {
    for (const [language, dict] of Object.entries(DICTS).filter(([language]) => language !== 'enUS')) {
      const problems: string[] = []
      walk(S_EN, dict, '', problems, language)
      expect(problems, language).toEqual([])
    }
  })

  it('sees inside a built sentence, which a stand-in value could not', () => {
    const shapesOf = shapes(((n: number, lang: string, size: string) => `${n} packs in ${lang}, ${size}`) as (...args: unknown[]) => unknown)
    expect(shapesOf.split('|').sort()).toEqual(['lang', 'n', 'size'])
  })

  it('notices a name dropped from one side', () => {
    const problems: string[] = []
    walk(
      { a: (n: number, folder: string) => `${n} packs in ${folder}` },
      { a: (n: number) => `${n} 个包` },
      '',
      problems
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('folder')
  })

  it('notices a plain placeholder renamed', () => {
    const problems: string[] = []
    walk({ a: 'Hi {name}' }, { a: '你好 {nmae}' }, '', problems)
    expect(problems).toHaveLength(1)
  })
})

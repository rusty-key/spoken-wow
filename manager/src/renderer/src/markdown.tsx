// A small, safe markdown renderer for release notes. It builds React elements from the text,
// so nothing is ever put into the page as HTML. Links open outside the window.
import type { ReactNode } from 'react'
import { api } from './api'

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'ul' | 'ol'; items: string[] }
  | { t: 'code'; text: string }
  | { t: 'quote'; text: string }
  | { t: 'hr' }

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = (): void => {
    if (para.length) out.push({ t: 'p', text: para.join(' ') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^\s*```/.test(line)) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) code.push(lines[i++] ?? '')
      out.push({ t: 'code', text: code.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      flush()
      out.push({ t: 'h', level: h[1]!.length, text: h[2]! })
      continue
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush()
      out.push({ t: 'hr' })
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const quote: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) quote.push((lines[i++] ?? '').replace(/^\s*>\s?/, ''))
      i--
      out.push({ t: 'quote', text: quote.join(' ') })
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      flush()
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length) {
        const cur = lines[i] ?? ''
        const m = ITEM.exec(cur)
        if (m) {
          items.push(m[1]!)
        } else if (cur.trim() && /^\s{2,}\S/.test(cur) && items.length) {
          items[items.length - 1] += ' ' + cur.trim()
        } else if (!cur.trim() && ITEM.test(lines[i + 1] ?? '')) {
          // a blank line inside a loose list
        } else {
          break
        }
        i++
      }
      i--
      out.push({ t: ordered ? 'ol' : 'ul', items })
      continue
    }
    para.push(line.trim())
  }
  flush()
  return out
}

const TOKEN =
  /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s](?:[^*]*[^*\s])?)\*|(?<![\w])_([^_\s](?:[^_]*[^_\s])?)_(?![\w])|\[([^\]]+)\]\((\S+?)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g

export function ExtLink({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        void api().openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

const SAFE = /^https?:\/\//i

function inline(text: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const key = `${depth}-${n++}`
    if (m[2] !== undefined) out.push(<code key={key}>{m[2]}</code>)
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<strong key={key}>{inline((m[3] ?? m[4])!, depth + 1)}</strong>)
    else if (m[5] !== undefined || m[6] !== undefined) out.push(<em key={key}>{inline((m[5] ?? m[6])!, depth + 1)}</em>)
    else if (m[7] !== undefined && m[8] !== undefined) {
      out.push(SAFE.test(m[8]) ? <ExtLink key={key} href={m[8]}>{inline(m[7], depth + 1)}</ExtLink> : m[7])
    } else if (m[9] !== undefined) out.push(<ExtLink key={key} href={m[9]}>{m[9]}</ExtLink>)
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }): ReactNode {
  const blocks = parseBlocks(text)
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h': {
            // Notes sit under a version heading, so their own headings start at h4.
            const level = Math.min(6, Math.max(4, b.level + 2))
            const Tag = `h${level}` as 'h4'
            return <Tag key={i}>{inline(b.text)}</Tag>
          }
          case 'p':
            return <p key={i}>{inline(b.text)}</p>
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it)}</li>
                ))}
              </ol>
            )
          case 'code':
            return (
              <pre key={i}>
                <code>{b.text}</code>
              </pre>
            )
          case 'quote':
            return <blockquote key={i}>{inline(b.text)}</blockquote>
          case 'hr':
            return <hr key={i} />
        }
      })}
    </div>
  )
}

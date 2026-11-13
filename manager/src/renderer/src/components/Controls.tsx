import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { S } from '../strings'
import { IconChevron } from './Icons'

/** A native select, labelled, with the manager's look. */
export function Select({
  label,
  value,
  onChange,
  children,
  inline = false,
  disabled = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
  inline?: boolean
  disabled?: boolean
}): ReactNode {
  const id = useId()
  return (
    <div className={`field${inline ? ' field-inline' : ''}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="select-wrap">
        <select id={id} className="select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
        <IconChevron size={16} className="select-chevron" />
      </div>
    </div>
  )
}

/** A checkbox drawn as a switch, saved as soon as it is flipped. */
export function Switch({
  checked,
  onChange,
  label,
  text
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  text?: string
}): ReactNode {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span className="switch-copy">
        <span className="switch-label">{label}</span>
        {text && <span className="switch-text">{text}</span>}
      </span>
    </label>
  )
}

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  icon?: ReactNode
}

/** A button that opens a small menu (arrow keys, Escape, click outside). */
export function Menu({ label, icon, items, className = '' }: { label: string; icon: ReactNode; items: MenuItem[]; className?: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const first = root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    first?.focus()
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      setOpen(false)
      button.current?.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const all = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
      const at = all.indexOf(document.activeElement as HTMLButtonElement)
      const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
      all[next]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div className={`menu ${className}`} ref={root} onKeyDown={onKey}>
      <button
        type="button"
        ref={button}
        className="btn btn-lg btn-square menu-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && (
        <div className="menu-list" role="menu" aria-label={label}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`menu-item${it.danger ? ' is-danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false)
                button.current?.focus()
                it.onSelect()
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Muted text that copies itself when clicked. */
export function CopyText({ text, label }: { text: string; label: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = (): void => {
    const done = (): void => {
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    }
    try {
      void navigator.clipboard.writeText(text).then(done, () => undefined)
    } catch {
      /* no clipboard: nothing to do */
    }
  }
  return (
    <div className="copytext">
      <span className="field-label">{label}</span>
      <button type="button" className="copytext-button" data-tip={copied ? S.common.copied : S.common.copy} aria-label={`${label}: ${text}. ${S.common.copy}`} onClick={copy}>
        <span className="ellipsis">{text}</span>
      </button>
    </div>
  )
}

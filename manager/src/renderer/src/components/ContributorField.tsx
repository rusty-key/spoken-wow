import { useId, type ReactNode } from 'react'

export function Field({ label, text, children }: { label: string; text?: string; children: (id: string) => ReactNode }): ReactNode {
  const id = useId()
  return (
    <div className="contrib-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(id)}
      {text && <span className="muted contrib-note">{text}</span>}
    </div>
  )
}

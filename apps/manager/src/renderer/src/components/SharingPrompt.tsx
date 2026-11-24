import { useEffect, useRef, useState, type ReactNode } from 'react'
import { errorText } from '../api'
import { useStore } from '../store'
import { S } from '../strings'
import { IconHeart } from './Icons'

/**
 * The first-start question: may the manager send what Spoken collects? Shown while the answer is
 * 'unset', which is also every manager updated from one that never asked. Escape closes it for
 * this run only, so it asks again next time; only the two buttons answer. An answer that could
 * not be saved stays open with the reason, rather than closing as if it had been.
 */
export function SharingPrompt(): ReactNode {
  const { state, actions } = useStore()
  const [closed, setClosed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLButtonElement>(null)
  const open = state.ready && !state.fatal && state.settings.sharing === 'unset' && !closed

  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setClosed(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const answer = (sharing: 'on' | 'off'): void => {
    setBusy(true)
    setError(null)
    void actions
      .setSettings({ sharing })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sharing-title" aria-describedby="sharing-text">
        <div className="modal-icon" aria-hidden="true">
          <IconHeart size={22} />
        </div>
        <h2 id="sharing-title" className="modal-title">
          {S.sharingPrompt.title}
        </h2>
        <p id="sharing-text" className="modal-text">
          {S.sharingPrompt.text}
        </p>
        <p className="modal-note">{S.sharingPrompt.note}</p>
        {error && (
          <p className="text-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button ref={first} type="button" className="btn" disabled={busy} onClick={() => answer('off')}>
            {S.sharingPrompt.no}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => answer('on')}>
            {S.sharingPrompt.yes}
          </button>
        </div>
      </div>
    </div>
  )
}

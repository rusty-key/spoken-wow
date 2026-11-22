import { useState, type ReactNode } from 'react'
import { api, errorText } from '../api'
import icon from '../assets/spoken.png'
import { useStore } from '../store'
import { S } from '../strings'

/** Pick a folder and add it as a game; the error from the main process stays in `error`. */
export function useAddGame(): { add: () => Promise<void>; scan: () => Promise<void>; error: string; busy: boolean; scanning: boolean } {
  const { actions } = useStore()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  return {
    error,
    busy,
    scanning,
    async add() {
      setError('')
      setBusy(true)
      try {
        const path = await api().pickFolder()
        if (!path) return
        const result = await actions.addGame(path)
        if (result.error) setError(result.error)
      } catch (e) {
        setError(errorText(e))
      } finally {
        setBusy(false)
      }
    },
    async scan() {
      setError('')
      setScanning(true)
      try {
        await actions.scan()
      } catch (e) {
        setError(errorText(e))
      } finally {
        setScanning(false)
      }
    }
  }
}

/** Shown on every game page when no install is known. */
export function EmptyGames(): ReactNode {
  const { add, scan, error, busy, scanning } = useAddGame()
  const { state } = useStore()
  return (
    <div className="empty scroll">
      <img className="empty-icon" src={icon} alt="" width={96} height={96} />
      <h1>{S.empty.title}</h1>
      <p>{S.empty.text(state.platform)}</p>
      <button type="button" className="btn btn-primary btn-lg" onClick={add} disabled={busy}>
        {S.empty.add}
      </button>
      {error && (
        <p className="text-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="link" onClick={scan} disabled={scanning} aria-busy={scanning}>
        {scanning ? S.empty.scanning + '…' : S.empty.scan}
      </button>
    </div>
  )
}

/** What the game pages show when there is no game to show. */
export function NoGame(): ReactNode {
  return <EmptyGames />
}

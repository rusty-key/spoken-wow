import type { ReactNode } from 'react'
import { jobBusy } from '../catalog'
import { useStore } from '../store'
import { S } from '../strings'

/** Off while a job runs, so one click cannot throw away a long download. */
export function RestartButton({ className }: { className: string }): ReactNode {
  const { state, actions } = useStore()
  const busy = Object.values(state.jobs).some(jobBusy)
  return (
    <button type="button" className={className} disabled={busy} title={busy ? S.banners.restartBusy : undefined} onClick={actions.restartManager}>
      {S.banners.restart}
    </button>
  )
}

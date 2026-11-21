import type { ReactNode } from 'react'
import type { ProductStatus } from '@shared/types'
import { S } from '../strings'
import { IconAlert, IconCheck, IconLink } from './Icons'

/** One line saying where Spoken stands on a game. */
export function SpokenStatus({ status }: { status: ProductStatus | undefined }): ReactNode {
  const state = status?.state ?? 'not-installed'
  const v = status?.installedVersion ?? ''
  switch (state) {
    case 'up-to-date':
      return (
        <p className="status status-ok">
          <IconCheck size={15} />
          {S.status.upToDate(v)}
        </p>
      )
    case 'update-available':
      return (
        <p className="status status-warn">
          <IconAlert size={15} />
          {S.status.updateAvailable(v, status?.latest?.version ?? '?')}
        </p>
      )
    case 'linked':
      return (
        <p className="status status-dev">
          <IconLink size={15} />
          {S.status.linked}
        </p>
      )
    case 'ahead':
      return (
        <p className="status status-ok">
          <IconCheck size={15} />
          {S.status.ahead(v)}
        </p>
      )
    case 'unknown':
      return <p className="status status-muted">{S.status.unknown(v || undefined)}</p>
    default:
      return <p className="status status-none">{S.status.notInstalled}</p>
  }
}

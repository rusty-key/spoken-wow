import type { ReactNode } from 'react'
import type { Flavor, GameInstall } from '@shared/types'
import { flavorLook, jobBusy, langTag, statusOf } from '../catalog'
import { jobKey, useStore } from '../store'
import { S } from '../strings'
import { CardArt } from './Brand'
import { useAddGame } from './EmptyGames'
import { JobBar } from './JobBar'
import { IconAlert, IconX } from './Icons'
import { SpokenStatus } from './SpokenStatus'

export function GameCard({ game }: { game: GameInstall }): ReactNode {
  const { state, actions } = useStore()
  const status = statusOf(state, game.id, 'spoken')
  const spokenState = status?.state ?? 'not-installed'

  const voice = (state.statuses[game.id] ?? []).filter((s) => s.productId !== 'spoken' && s.state !== 'not-installed')
  const langs = [
    ...new Set(
      voice.map((s) => state.products.find((p) => p.id === s.productId)?.lang).filter((l): l is string => !!l)
    )
  ]
  const outdated = voice.filter((s) => s.state === 'update-available')
  const updateProducts = [...(spokenState === 'update-available' ? ['spoken'] : []), ...outdated.map((s) => s.productId)]
  // Update queues one job per product, so show whichever runs, else one that failed.
  const gameJobs = Object.values(state.jobs).filter((j) => j.gameId === game.id)
  const job =
    gameJobs.find(jobBusy) ??
    gameJobs.find((j) => j.phase === 'error' && updateProducts.includes(j.productId)) ??
    gameJobs.find((j) => j.productId === 'spoken')
  const busy = jobBusy(job)
  const updateAll = async (): Promise<void> => {
    for (const productId of updateProducts) await actions.install(game.id, productId)
  }

  const primary =
    spokenState === 'not-installed'
      ? { text: S.home.installSpoken, disabled: !game.writable || !status?.latest, run: () => void actions.install(game.id, 'spoken') }
      : updateProducts.length > 0
        ? { text: S.home.update, disabled: !game.writable, run: () => void updateAll() }
        : { text: S.home.manage, disabled: false, run: () => actions.navigate('spoken', game.id) }

  return (
    <article className="card game-card">
      <button type="button" className="art-button" aria-label={S.home.openSpoken(game.label)} onClick={() => actions.navigate('spoken', game.id)}>
        <CardArt flavor={game.flavor} />
      </button>
      <div className="game-card-body">
        <p className="eyebrow">{game.gameVersion ? `Game Version ${game.gameVersion}` : game.flavorFolder}</p>
        <h2 className="game-name">{game.label}</h2>

        {busy ? (
          <div className="game-job">
            <JobBar job={job} size="sm" onCancel={() => actions.cancel(job.jobId)} />
          </div>
        ) : (
          <>
            <SpokenStatus status={status} />
            {job?.phase === 'error' && (
              <p className="status status-error" role="alert">
                <IconAlert size={14} />
                <span>{job.message ?? S.jobs.error}</span>
                <button type="button" className="icon-btn icon-btn-sm" aria-label={S.common.dismiss} onClick={() => actions.dismissJob(jobKey(game.id, job.productId))}>
                  <IconX size={13} />
                </button>
              </p>
            )}
            {job?.phase === 'done' && job.message && <p className="status status-ok-text">{job.message}</p>}
          </>
        )}

        <div className="flags">
          {voice.length > 0 ? (
            <>
              <span className="flag">{S.home.voicePacks(voice.length)}</span>
              {langs.map((l) => (
                <span key={l} className="tag">
                  {langTag(l)}
                </span>
              ))}
            </>
          ) : (
            <span className="flag flag-muted">{S.home.noVoice}</span>
          )}
        </div>
        {outdated.length > 0 && <p className="flag-line">{S.home.packUpdates(outdated.length)}</p>}
        {!game.writable && <p className="flag-line flag-line-red">{S.common.readOnly}</p>}

        <div className="game-actions">
          {!busy && (
            <button type="button" className="btn btn-primary" disabled={primary.disabled} onClick={primary.run}>
              {primary.text}
            </button>
          )}
          <button type="button" className="btn" onClick={() => actions.navigate('voices', game.id)}>
            {S.home.voicePacksButton}
          </button>
        </div>
      </div>
    </article>
  )
}

/** A supported game the scan did not find: the same card, dimmed and disabled, with a way to add its folder. */
export function MissingCard({ flavor }: { flavor: Flavor }): ReactNode {
  const look = flavorLook(flavor)
  const { add, error, busy } = useAddGame()
  return (
    <article className="card game-card is-missing">
      <div className="art-static">
        <CardArt flavor={flavor} />
      </div>
      <div className="game-card-body">
        <p className="eyebrow">{look.name}</p>
        <h2 className="game-name">{look.label}</h2>
        <p className="status">{S.home.notInstalled}</p>
        <button type="button" className="link link-add" onClick={add} disabled={busy}>
          {S.home.addFolder}
        </button>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        <div className="game-actions">
          <button type="button" className="btn btn-primary" disabled>
            {S.home.installSpoken}
          </button>
          <button type="button" className="btn" disabled>
            {S.home.voicePacksButton}
          </button>
        </div>
      </div>
    </article>
  )
}

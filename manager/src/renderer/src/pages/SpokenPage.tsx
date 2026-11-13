import { useState, type ReactNode } from 'react'
import type { GameInstall, ReleaseInfo } from '@shared/types'
import { compareVersions } from '@shared/version'
import { api } from '../api'
import { jobBusy, releasesFor, statusOf } from '../catalog'
import { RailTop } from '../components/Brand'
import { CopyText, Menu, Select } from '../components/Controls'
import { NoGame } from '../components/EmptyGames'
import { IconAlert, IconCheck, IconExternal, IconFolder, IconGear, IconLink, IconRefresh, IconX } from '../components/Icons'
import { JobBar } from '../components/JobBar'
import { SpokenStatus } from '../components/SpokenStatus'
import { formatDate } from '../format'
import { Markdown } from '../markdown'
import { REPO_URL, S } from '../strings'
import { jobKey, useGame, useStore, type SpokenTab } from '../store'

export function SpokenPage(): ReactNode {
  const game = useGame()
  if (!game) return <NoGame />
  return <SpokenFor key={game.id} game={game} />
}

function SpokenFor({ game }: { game: GameInstall }): ReactNode {
  const { state, actions } = useStore()
  const [picked, setPicked] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const status = statusOf(state, game.id, 'spoken')
  const releases = releasesFor(state.catalog, 'spoken', state.settings.includePrereleases)
  const latest = status?.latest ?? releases[0]
  const installed = status?.installedVersion
  const selected = picked || latest?.version || ''
  const job = state.jobs[jobKey(game.id, 'spoken')]
  const busy = jobBusy(job)
  const linked = status?.state === 'linked'
  const present = !!status && status.state !== 'not-installed'

  const versionOptions = releases.map((r) => {
    const marks = [r.version === latest?.version ? S.common.latest : '', r.version === installed ? S.common.installed : '', r.prerelease ? S.spoken.prerelease : '']
      .filter(Boolean)
      .join(', ')
    return { value: r.version, label: marks ? `${r.version} (${marks})` : r.version }
  })

  const cmp = installed && selected ? compareVersions(selected, installed) : null
  const buttonText = !selected
    ? S.spoken.noRelease
    : !present
      ? selected === latest?.version
        ? S.spoken.install
        : S.spoken.installVersion(selected)
      : cmp === 0
        ? S.spoken.reinstall
        : cmp !== null && cmp > 0
          ? S.spoken.updateTo(selected)
          : S.spoken.installVersion(selected)

  const run = (version?: string): void => void actions.install(game.id, 'spoken', version && version !== latest?.version ? version : undefined)
  const repair = (): void => void actions.repair(game.id, 'spoken')
  const tab = state.spokenTab
  const setTab = (t: SpokenTab): void => actions.navigate('spoken', game.id, t)

  return (
    <div className="frame">
      <aside className="rail scroll" aria-label={S.spoken.ariaGame}>
        <RailTop game={game} />
        <div className="rail-bottom">
          <Select label={S.spoken.channel} value={selected} onChange={setPicked} disabled={releases.length === 0}>
            {versionOptions.length === 0 && <option value="">{S.spoken.noRelease}</option>}
            {versionOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          {busy ? (
            <JobBar job={job} size="lg" onCancel={() => actions.cancel(job.jobId)} />
          ) : (
            <div className="install-row">
              <button
                type="button"
                className="btn btn-primary btn-play"
                disabled={linked || !selected || !game.writable}
                onClick={() => run(selected)}
              >
                {linked ? S.spoken.linkedButton : buttonText}
              </button>
              <Menu
                label={S.spoken.moreActions}
                icon={<IconGear size={20} />}
                items={[
                  { label: S.spoken.openAddOns, icon: <IconFolder size={16} />, onSelect: () => void api().openPath(game.addOnsPath) },
                  { label: S.spoken.repair, icon: <IconRefresh size={16} />, disabled: linked || !present || !game.writable, onSelect: repair },
                  { label: S.spoken.removeItem, danger: true, disabled: linked || !present || !game.writable, icon: <IconX size={16} />, onSelect: () => setConfirmRemove(true) },
                  { label: S.spoken.github, icon: <IconExternal size={16} />, onSelect: () => void api().openExternal(latest?.htmlUrl ?? REPO_URL) }
                ]}
              />
            </div>
          )}

          <SpokenStatus status={status} />

          {!game.writable && (
            <p className="status status-error">
              <IconAlert size={14} />
              {S.common.readOnly}
            </p>
          )}

          {confirmRemove && !busy && (
            <div className="confirm" role="alertdialog" aria-label={S.spoken.removeItem}>
              <p>{S.spoken.confirmRemove(game.label)}</p>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setConfirmRemove(false)
                    void actions.uninstall(game.id, 'spoken')
                  }}
                >
                  {S.common.remove}
                </button>
                <button type="button" className="btn" onClick={() => setConfirmRemove(false)}>
                  {S.common.keep}
                </button>
              </div>
            </div>
          )}

          {job?.phase === 'done' && (
            <p className="notice notice-ok" role="status">
              <IconCheck size={16} />
              <span>{job.message ?? S.jobs.done}</span>
              <button type="button" className="icon-btn icon-btn-sm" aria-label={S.common.dismiss} onClick={() => actions.dismissJob(jobKey(game.id, 'spoken'))}>
                <IconX size={13} />
              </button>
            </p>
          )}
          {job?.phase === 'error' && (
            <div className="notice notice-error" role="alert">
              <IconAlert size={16} />
              <span>{job.message ?? S.jobs.error}</span>
              <div className="notice-actions">
                <button type="button" className="link" onClick={() => (job.action === 'uninstall' ? void actions.uninstall(game.id, 'spoken') : job.action === 'repair' ? repair() : run(job.version))}>
                  {S.common.retry}
                </button>
                <button type="button" className="link link-muted" onClick={() => actions.dismissJob(jobKey(game.id, 'spoken'))}>
                  {S.common.dismiss}
                </button>
              </div>
            </div>
          )}

          <CopyText text={game.addOnsPath} label={S.spoken.addOnsPath} />
        </div>
      </aside>

      <section className="center scroll">
        <div className="center-inner">
          <div className="pill-row pill-row-end">
            <button type="button" className="pill pill-action" title={S.common.showIn(state.platform)} onClick={() => void api().openPath(game.addOnsPath)}>
              {S.spoken.openAddOns}
            </button>
            <button type="button" className="pill pill-action" onClick={() => void api().openExternal(latest?.htmlUrl ?? REPO_URL)}>
              {S.spoken.github}
            </button>
          </div>

          <div className="subtabs" role="tablist" aria-label="Spoken">
            {(['modules', 'changelog'] as const).map((t) => (
              <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className="subtab" onClick={() => setTab(t)}>
                {t === 'modules' ? S.spoken.tabModules : S.spoken.tabChangelog}
              </button>
            ))}
          </div>
          {tab === 'modules' ? (
            <div role="tabpanel" id="panel-modules" aria-labelledby="tab-modules">
              <Modules folders={status?.installedFolders ?? []} linked={linked} />
            </div>
          ) : (
            <div role="tabpanel" id="panel-changelog" aria-labelledby="tab-changelog">
              <Changelog releases={releases} installed={installed} />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Modules({ folders, linked }: { folders: string[]; linked: boolean }): ReactNode {
  const have = new Set(folders.map((f) => f.toLowerCase()))
  return (
    <ul className="list card">
      {S.modules.map((m) => {
        // A module may live under its older or newer folder name.
        const name = [m.folder, 'alt' in m ? m.alt : undefined].find((f) => f && have.has(f.toLowerCase())) ?? m.folder
        const present = have.has(name.toLowerCase())
        return (
          <li key={m.folder} className="row">
            <div className="row-main">
              <span className="row-title">{m.title}</span>
              <span className="row-text">{m.text}</span>
            </div>
            <code className="folder-name">{name}</code>
            {linked && present ? (
              <span className="badge badge-dev">
                <IconLink size={13} />
                {S.spoken.linkedState}
              </span>
            ) : present ? (
              <span className="badge badge-ok">
                <IconCheck size={13} />
                {S.spoken.installedState}
              </span>
            ) : (
              <span className="badge badge-muted">{S.spoken.missing}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Changelog({ releases, installed }: { releases: ReleaseInfo[]; installed?: string }): ReactNode {
  if (releases.length === 0) return <p className="muted card pad">{S.spoken.noReleases}</p>
  return (
    <div className="changelog">
      {releases.map((r) => (
        <article key={r.tag} className="card release">
          <header className="release-head">
            <h2>{r.version}</h2>
            {r.prerelease && <span className="tag tag-warn">{S.spoken.prerelease}</span>}
            {r.version === installed && <span className="tag tag-ok">{S.spoken.installedState}</span>}
            <span className="muted release-date">{formatDate(r.publishedAt)}</span>
          </header>
          <Markdown text={r.notes || S.spoken.noNotes} />
        </article>
      ))}
    </div>
  )
}

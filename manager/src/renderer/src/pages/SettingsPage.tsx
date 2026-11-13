import { useState, type ReactNode } from 'react'
import { formatBytes, formatDate, formatTime } from '../format'
import { api, errorText } from '../api'
import { GameIcon } from '../components/Brand'
import { Select, Switch } from '../components/Controls'
import { useAddGame } from '../components/EmptyGames'
import { RestartButton } from '../components/RestartButton'
import { IconChevron, IconChevronRight, IconDownload, IconGames, IconGear, IconHeart, IconInfo, IconRefresh, IconUser } from '../components/Icons'
import type { Settings, UiLanguage } from '@shared/types'
import { UI_LANGUAGES } from '@shared/types'
import { languageName } from '@shared/products'
import { useStore } from '../store'
import { ContributorSection } from './ContributorSection'
import { REPO_URL, S, SITE_URL } from '../strings'

type Section = 'games' | 'updates' | 'general' | 'downloads' | 'sharing' | 'contributor' | 'about'

export function SettingsPage(): ReactNode {
  const { state } = useStore()
  const [section, setSection] = useState<Section>('games')
  /**
   * Built here, not at module load: an entry made once would keep the language the window
   * started in. The words stay written as `S.settings.x`, so a reader finds them by searching.
   */
  const nav: { id: Section; label: string; icon: ReactNode }[] = [
    { id: 'games', label: S.settings.folders, icon: <IconGames size={18} /> },
    { id: 'updates', label: S.settings.updates, icon: <IconRefresh size={18} /> },
    { id: 'general', label: S.settings.general, icon: <IconGear size={18} /> },
    { id: 'downloads', label: S.settings.downloads, icon: <IconDownload size={18} /> },
    { id: 'sharing', label: S.settings.sharing, icon: <IconHeart size={18} /> },
    { id: 'contributor', label: S.settings.contributor, icon: <IconUser size={18} /> },
    { id: 'about', label: S.settings.about, icon: <IconInfo size={18} /> }
  ]
  return (
    <div className="settings">
      <header className="settings-head">
        <h1>{S.settings.title}</h1>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label={S.settings.title}>
          {nav.map((n) => (
            <button key={n.id} type="button" className="nav-item" aria-current={section === n.id ? 'page' : undefined} onClick={() => setSection(n.id)}>
              {n.icon}
              {n.label}
            </button>
          ))}
        </nav>
        <div className="settings-content scroll">
          <div className="settings-inner">
            {section === 'games' && <GamesSection />}
            {section === 'updates' && <UpdatesSection />}
            {section === 'general' && <GeneralSection />}
            {section === 'downloads' && <DownloadsSection />}
            {section === 'sharing' && <SharingSection />}
            {section === 'contributor' && <ContributorSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
      <footer className="settings-footer">{state.appVersion}</footer>
    </div>
  )
}

function GamesSection(): ReactNode {
  const { state, actions } = useStore()
  const { add, scan, error, busy, scanning } = useAddGame()
  const [open, setOpen] = useState<Set<string>>(() => new Set(state.games.slice(0, 1).map((g) => g.id)))
  const allOpen = state.games.length > 0 && state.games.every((g) => open.has(g.id))
  const toggle = (id: string): void =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <section aria-labelledby="set-folders">
      <div className="settings-title-row">
        <h2 id="set-folders" className="settings-h">
          {S.settings.folders}
        </h2>
        {state.games.length > 1 && (
          <button type="button" className="link" onClick={() => setOpen(allOpen ? new Set() : new Set(state.games.map((g) => g.id)))}>
            {allOpen ? S.settings.collapseAll : S.settings.expandAll}
          </button>
        )}
      </div>
      <p className="settings-text">{S.settings.foldersText}</p>

      {state.games.length === 0 ? (
        <p className="muted">{S.settings.noFolders}</p>
      ) : (
        <ul className="acc-list">
          {state.games.map((g) => {
            const expanded = open.has(g.id)
            return (
              <li key={g.id} className="acc">
                <button type="button" className="acc-head" aria-expanded={expanded} aria-controls={`acc-${g.id}`} onClick={() => toggle(g.id)}>
                  {expanded ? <IconChevron size={14} /> : <IconChevronRight size={14} />}
                  <GameIcon flavor={g.flavor} />
                  <span className="acc-title">{g.label}</span>
                  <span className={`badge ${g.source === 'auto' ? 'badge-muted' : 'badge-info'}`}>{g.source === 'auto' ? S.settings.auto : S.settings.manual}</span>
                </button>
                {expanded && (
                  <div className="acc-body" id={`acc-${g.id}`}>
                    <span className="field-label">{S.settings.installLocation}</span>
                    <div className="path-line">
                      <span className="input ellipsis" title={g.root}>
                        {g.root}
                      </span>
                      <button type="button" className="btn" title={S.common.showIn(state.platform)} onClick={() => void api().openPath(g.root)}>
                        {S.common.open}
                      </button>
                      {g.source === 'manual' && (
                        <button type="button" className="btn" onClick={() => void actions.removeGame(g.id)}>
                          {S.common.remove}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="setting-actions">
        <button type="button" className="btn" onClick={add} disabled={busy}>
          {S.empty.add}
        </button>
        <button type="button" className="btn" onClick={scan} disabled={scanning} aria-busy={scanning}>
          {S.empty.scan}
        </button>
      </div>
      {error && (
        <p className="text-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function useSetSettings(): (patch: Partial<Settings>) => void {
  const { actions } = useStore()
  return (patch) => void actions.setSettings(patch).catch(() => undefined)
}

function UpdatesSection(): ReactNode {
  const { state } = useStore()
  const { settings } = state
  const set = useSetSettings()
  return (
    <section aria-labelledby="set-updates">
      <h2 id="set-updates" className="settings-h">
        {S.settings.updates}
      </h2>
      <div className="switches">
        <Switch checked={settings.includePrereleases} onChange={(v) => set({ includePrereleases: v })} label={S.settings.prereleases} text={S.settings.prereleasesText} />
        <Switch checked={settings.checkOnStart} onChange={(v) => set({ checkOnStart: v })} label={S.settings.checkOnStart} text={S.settings.checkOnStartText} />
        <Switch checked={settings.autoUpdateContent} onChange={(v) => set({ autoUpdateContent: v })} label={S.settings.autoUpdateContent} text={S.settings.autoUpdateContentText} />
        <Switch checked={settings.autoUpdateManager} onChange={(v) => set({ autoUpdateManager: v })} label={S.settings.autoUpdate} text={S.settings.autoUpdateText} />
      </div>
    </section>
  )
}

function GeneralSection(): ReactNode {
  const { state } = useStore()
  const { settings } = state
  const set = useSetSettings()
  return (
    <section aria-labelledby="set-general">
      <h2 id="set-general" className="settings-h">
        {S.settings.general}
      </h2>
      <Select label={S.settings.languageName} value={settings.uiLanguage} onChange={(v) => set({ uiLanguage: v as UiLanguage })}>
        {UI_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {languageName(l.code)}
          </option>
        ))}
      </Select>
      <p className="settings-text">{S.settings.languageText}</p>
      <h3 className="settings-h settings-h-sub">{S.settings.startup}</h3>
      <div className="switches">
        <Switch checked={settings.startAtLogin} onChange={(v) => set({ startAtLogin: v })} label={S.settings.startAtLogin} text={S.settings.startAtLoginText} />
        <Switch checked={settings.minimizeToTray} onChange={(v) => set({ minimizeToTray: v })} label={S.settings.minimizeToTray} text={S.settings.minimizeToTrayText} />
      </div>
    </section>
  )
}

function DownloadsSection(): ReactNode {
  const { state, actions } = useStore()
  const { settings } = state
  const [downloadError, setDownloadError] = useState('')
  const [cleared, setCleared] = useState('')
  const [clearing, setClearing] = useState(false)
  const useDefault = (): void => {
    setDownloadError('')
    void actions.setSettings({ downloadsPath: '' }).catch((e) => setDownloadError(errorText(e)))
  }
  const set = useSetSettings()
  const clear = async (): Promise<void> => {
    setCleared('')
    setDownloadError('')
    setClearing(true)
    try {
      const r = await api().clearDownloads()
      setCleared(r.files === 0 ? S.settings.clearedNone : S.settings.cleared(r.files, formatBytes(r.bytes)))
    } catch (e) {
      setDownloadError(errorText(e))
    } finally {
      setClearing(false)
    }
  }
  const changeDownloads = async (): Promise<void> => {
    setDownloadError('')
    setCleared('')
    try {
      const path = await api().pickFolder()
      if (path) await actions.setSettings({ downloadsPath: path })
    } catch (e) {
      setDownloadError(errorText(e))
    }
  }
  return (
    <section aria-labelledby="set-downloads">
      <h2 id="set-downloads" className="settings-h">
        {S.settings.downloads}
      </h2>
      <span className="field-label">{S.settings.downloadsFolder}</span>
      <div className="path-line">
        <span className={`input ellipsis${settings.downloadsPath ? '' : ' is-default'}`} title={settings.downloadsPath || state.dataPath}>
          {settings.downloadsPath || S.settings.appFolder}
        </span>
        <button type="button" className="btn" onClick={() => void changeDownloads()}>
          {S.common.change}
        </button>
        <button type="button" className="btn" onClick={() => void api().openPath(settings.downloadsPath || state.dataPath)}>
          {S.common.open}
        </button>
        {settings.downloadsPath && (
          <button type="button" className="link" onClick={useDefault}>
            {S.settings.useDefault}
          </button>
        )}
      </div>
      {downloadError && (
        <p className="text-error" role="alert">
          {downloadError}
        </p>
      )}
      <div className="setting-actions">
        <button type="button" className="btn" onClick={() => void clear()} disabled={clearing} aria-busy={clearing}>
          {S.settings.clearDownloads}
        </button>
      </div>
      {cleared && (
        <p className="status status-ok-text setting-result" role="status">
          {cleared}
        </p>
      )}
      <div className="switches">
        <Switch checked={settings.keepDownloads} onChange={(v) => set({ keepDownloads: v })} label={S.settings.keepZips} text={S.settings.keepZipsText} />
      </div>
    </section>
  )
}

function SharingSection(): ReactNode {
  const { state, actions } = useStore()
  const { sharing } = state
  const on = state.settings.sharing === 'on'
  const [reset, setReset] = useState(false)
  const last = sharing.lastSent
  const resetId = async (): Promise<void> => {
    await api().resetShareId()
    setReset(true)
  }
  return (
    <section aria-labelledby="set-sharing">
      <h2 id="set-sharing" className="settings-h">
        {S.settings.sharing}
      </h2>
      <div className="switches">
        <Switch
          checked={on}
          onChange={(v) => void actions.setSettings({ sharing: v ? 'on' : 'off' }).catch(() => undefined)}
          label={S.settings.sharingSwitch}
          text={S.settings.sharingText}
        />
      </div>
      <p className="settings-text" role="status">
        {sharing.sending ? `${S.settings.sending}…` : last ? S.settings.lastSent(last.count, `${formatDate(last.at)} ${formatTime(last.at)}`) : S.settings.neverSent}
      </p>
      {sharing.error && (
        <p className="text-error" role="alert">
          {sharing.error}
        </p>
      )}
      <div className="setting-actions">
        <button type="button" className="btn" onClick={() => void actions.shareNow()} disabled={!on || sharing.sending} aria-busy={sharing.sending}>
          {S.settings.sendNow}
        </button>
        <button type="button" className="btn" onClick={() => void resetId()}>
          {S.settings.resetId}
        </button>
      </div>
      {reset && (
        <p className="status status-ok-text setting-result" role="status">
          {S.settings.resetDone}
        </p>
      )}
    </section>
  )
}

function AboutSection(): ReactNode {
  const { state, actions } = useStore()
  const [asked, setAsked] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const u = state.updater
  const busy = waiting || u.state === 'checking' || u.state === 'downloading'
  const check = async (): Promise<void> => {
    setAsked(true)
    setWaiting(true)
    await actions.checkManagerUpdate()
    setWaiting(false)
  }
  const result =
    u.state === 'checking' || waiting
      ? { text: S.settings.updateChecking, cls: 'status-muted' }
      : u.state === 'available'
        ? { text: u.url ? S.banners.updateAvailable(u.version) : S.settings.updateAvailable(u.version), cls: 'status-warn' }
        : u.state === 'downloading'
          ? { text: S.banners.updating(Math.round(u.percent)), cls: 'status-muted' }
          : u.state === 'ready'
            ? { text: u.message ?? S.banners.updateReady(u.version), cls: u.message ? 'status-error' : 'status-ok-text' }
            : u.state === 'error'
              ? { text: u.message, cls: 'status-error' }
              : asked
                ? { text: S.settings.updateCurrent, cls: 'status-ok-text' }
                : null
  return (
    <section aria-labelledby="set-about">
      <h2 id="set-about" className="settings-h">
        {S.settings.about}
      </h2>
      <dl className="about">
        <dt className="field-label">{S.settings.version}</dt>
        <dd>{state.appVersion || '-'}</dd>
        <dt className="field-label">{S.settings.dataPath}</dt>
        <dd className="ellipsis" title={state.dataPath}>
          {state.dataPath || '-'}
        </dd>
      </dl>
      <p className="settings-text disclaimer">{S.settings.disclaimer}</p>
      <div className="setting-actions">
        <button type="button" className="btn" onClick={() => void check()} disabled={busy || u.state === 'ready'} aria-busy={busy}>
          {S.settings.checkUpdate}
        </button>
        {u.state === 'available' && u.url && (
          <button type="button" className="btn btn-primary" onClick={() => void api().openExternal(u.url!)}>
            {S.banners.download}
          </button>
        )}
        {u.state === 'ready' && <RestartButton className="btn btn-primary" />}
        <button type="button" className="btn" title={S.common.showIn(state.platform)} onClick={() => void api().openLogs()}>
          {S.settings.openLogs}
        </button>
        <button type="button" className="btn" onClick={() => void api().openExternal(REPO_URL)}>
          {S.settings.repository}
        </button>
        <button type="button" className="btn" onClick={() => void api().openExternal(SITE_URL)}>
          {S.settings.site}
        </button>
      </div>
      {result && (
        <p className={`status ${result.cls} setting-result`} role={u.state === 'error' ? 'alert' : 'status'}>
          {result.text}
        </p>
      )}
    </section>
  )
}

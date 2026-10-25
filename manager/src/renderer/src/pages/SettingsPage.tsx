import { useState, type ReactNode } from 'react'
import { formatBytes, formatDate, formatTime } from '../format'
import { api, errorText } from '../api'
import { GameIcon } from '../components/Brand'
import { Switch } from '../components/Controls'
import { useAddGame } from '../components/EmptyGames'
import { IconChevron, IconChevronRight, IconDownload, IconGames, IconHeart, IconInfo, IconRefresh } from '../components/Icons'
import { useStore } from '../store'
import { REPO_URL, S, SITE_URL } from '../strings'

type Section = 'games' | 'updates' | 'downloads' | 'sharing' | 'generate' | 'about'

const NAV: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'games', label: S.settings.folders, icon: <IconGames size={18} /> },
  { id: 'updates', label: S.settings.updates, icon: <IconRefresh size={18} /> },
  { id: 'downloads', label: S.settings.downloads, icon: <IconDownload size={18} /> },
  { id: 'sharing', label: S.settings.sharing, icon: <IconHeart size={18} /> },
  { id: 'generate', label: S.settings.generate, icon: <IconRefresh size={18} /> },
  { id: 'about', label: S.settings.about, icon: <IconInfo size={18} /> }
]

export function SettingsPage(): ReactNode {
  const { state } = useStore()
  const [section, setSection] = useState<Section>('games')
  return (
    <div className="settings">
      <header className="settings-head">
        <h1>{S.settings.title}</h1>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label={S.settings.title}>
          {NAV.map((n) => (
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
            {section === 'downloads' && <DownloadsSection />}
            {section === 'sharing' && <SharingSection />}
            {section === 'generate' && <GenerateSection />}
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

function UpdatesSection(): ReactNode {
  const { state, actions } = useStore()
  const { settings } = state
  const set = (patch: Parameters<typeof actions.setSettings>[0]): void => void actions.setSettings(patch).catch(() => undefined)
  return (
    <section aria-labelledby="set-updates">
      <h2 id="set-updates" className="settings-h">
        {S.settings.updates}
      </h2>
      <div className="switches">
        <Switch checked={settings.includePrereleases} onChange={(v) => set({ includePrereleases: v })} label={S.settings.prereleases} text={S.settings.prereleasesText} />
        <Switch checked={settings.checkOnStart} onChange={(v) => set({ checkOnStart: v })} label={S.settings.checkOnStart} text={S.settings.checkOnStartText} />
        <Switch checked={settings.autoUpdateManager} onChange={(v) => set({ autoUpdateManager: v })} label={S.settings.autoUpdate} text={S.settings.autoUpdateText} />
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
  const set = (patch: Parameters<typeof actions.setSettings>[0]): void => void actions.setSettings(patch).catch(() => undefined)
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

const PROVIDER_LABEL = { elevenlabs: 'ElevenLabs', fish: 'fish.audio' } as const

function GenerateSection(): ReactNode {
  const { state, actions } = useStore()
  const g = state.generate
  const [error, setError] = useState('')
  const [entries, setEntries] = useState<{ elevenlabs: string; fish: string }>({ elevenlabs: '', fish: '' })
  const run = async (work: () => Promise<void>): Promise<void> => {
    setError('')
    try {
      await work()
    } catch (e) {
      setError(errorText(e))
    }
  }
  if (!g) {
    return (
      <section aria-labelledby="set-generate">
        <h2 id="set-generate" className="settings-h">
          {S.settings.generate}
        </h2>
        <p className="settings-text">{S.settings.generateUnavailable}</p>
      </section>
    )
  }
  return (
    <section aria-labelledby="set-generate">
      <h2 id="set-generate" className="settings-h">
        {S.settings.generate}
      </h2>
      <p className="settings-text">{S.settings.generateText}</p>

      <p className="settings-text" role="status">
        {g.pairedAs ? S.settings.pairedAs(g.pairedAs) : S.settings.notPaired}
      </p>
      {g.pairing && <p className="settings-text">{S.settings.pairingCode(g.pairing.code)}</p>}
      <div className="setting-actions">
        {g.pairedAs ? (
          <button type="button" className="btn" onClick={() => void run(() => api().generateUnpair())}>
            {S.settings.unpair}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void run(() => api().generatePair())}>
            {S.settings.pair}
          </button>
        )}
        {g.pairing && (
          <button type="button" className="btn" onClick={() => void api().openExternal(g.pairing!.verifyUrl)}>
            {S.settings.openPairing}
          </button>
        )}
      </div>

      {(['elevenlabs', 'fish'] as const).map((provider) => (
        <div key={provider}>
          <span className="field-label">
            {S.settings.keyFor(PROVIDER_LABEL[provider])}: {g.keys[provider] ? S.settings.keySet : S.settings.keyMissing} ·{' '}
            {g.modes[provider] === 'local' ? S.settings.generatesHere : S.settings.generatesOnSite}
          </span>
          <form
            className="path-line"
            onSubmit={(e) => {
              e.preventDefault()
              void run(async () => {
                await api().generateSetKey(provider, entries[provider])
                setEntries((prev) => ({ ...prev, [provider]: '' }))
              })
            }}
          >
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder={S.settings.keyPlaceholder}
              value={entries[provider]}
              onChange={(e) => setEntries((prev) => ({ ...prev, [provider]: e.target.value }))}
              aria-label={S.settings.keyFor(PROVIDER_LABEL[provider])}
            />
            <button type="submit" className="btn" disabled={entries[provider].trim() === ''}>
              {S.settings.saveKey}
            </button>
            {g.keys[provider] && (
              <button type="button" className="btn" onClick={() => void run(() => api().generateSetKey(provider, ''))}>
                {S.settings.removeKey}
              </button>
            )}
          </form>
        </div>
      ))}

      <div className="switches">
        <Switch
          checked={state.settings.generating}
          onChange={(v) => void actions.setSettings({ generating: v }).catch((e) => setError(errorText(e)))}
          label={S.settings.generateSwitch}
          text={S.settings.generateSwitchText}
        />
      </div>
      {state.settings.generating && (
        <p className="settings-text" role="status">
          {g.current.length > 0 ? S.settings.generateNow(g.current.length) : S.settings.generateIdle} {S.settings.generateCounts(g.done, g.failed)}
        </p>
      )}
      {(error || g.error) && (
        <p className="text-error" role="alert">
          {error || g.error}
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
            ? { text: S.banners.updateReady(u.version), cls: 'status-ok-text' }
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
        <button type="button" className="btn" onClick={() => void check()} disabled={busy} aria-busy={busy}>
          {S.settings.checkUpdate}
        </button>
        {u.state === 'available' && u.url && (
          <button type="button" className="btn btn-primary" onClick={() => void api().openExternal(u.url!)}>
            {S.banners.download}
          </button>
        )}
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

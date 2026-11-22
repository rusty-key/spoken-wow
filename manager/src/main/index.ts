// Spoken Manager: main process. The network traffic is the GitHub release list, the voice pack
// server, the asset downloads and the manager's own update, plus, only when the player turned
// Sharing on, the lines Spoken collected, sent to spoken.quest (share.ts), and, only for a
// language admin who signs in, the site and that admin's stores (contributor.ts).
import path from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, net, safeStorage, session, shell, Tray, type NativeImage } from 'electron'
import { CHANNELS, type UpdaterState } from '../shared/api'
import type { Settings } from '../shared/types'
import { windowChrome } from './chrome'
import type { SecretBox } from './contributor-store'
import { isAllowedExternalUrl } from './external'
import { registerIpc } from './ipc'
import { proxyConfig } from './proxy'
import { proxyRoute } from './proxy-agent'
import { ManagerService } from './service'
import { HIDDEN_ARG, updateLinuxAutostart } from './startup'
import { initLog, log } from './state'
import { isOurPage as isOurPageUrl, type AppPage } from './trust'
import { fetchWithLimit, managerUpdateOnTheWire, startUpdater } from './updater'
import { t } from './i18n'

app.setName('Spoken Manager')
if (process.platform === 'win32') app.setAppUserModelId('one.rusty.spoken.manager')

const BACKGROUND = '#16171d'
const DEV_URL = process.env.ELECTRON_RENDERER_URL

let service: ManagerService | null = null
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const iconPath = (): string => path.join(app.getAppPath(), 'build', 'icon.png')
// Each state is sent once, so a window opened later (macOS, from the Dock) reads it from the snapshot.
let updaterState: UpdaterState = { state: 'idle' }

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// Node's own fetch (undici) brings the whole main process down when a server closes the connection while a large
// body is held back because the disk write is slower (`assert(!this.paused)` in Parser.finish, uncaught). Chromium's
// network stack does not, and it follows the session's proxy. `no-store`: the packs are not worth a copy in its cache.
// `omit`: net.fetch would otherwise keep and resend cookies, and the Manager sends only the request and a User-Agent.
//
// Every request waits for the proxy: `closeAllConnections` would cut off one sent while it is being set.
let proxyReady: Promise<void> = Promise.resolve()
const chromiumFetch: typeof fetch = async (input, init) => {
  await proxyReady
  return net.fetch(input instanceof URL ? input.href : input, { ...init, cache: 'no-store', credentials: 'omit' })
}

// An empty setting leaves Node going direct: its fetch cannot read the system proxy. `dispatcher` is not part of
// the DOM's RequestInit, hence the casts.
const nodeFetch: typeof fetch = async (input, init) => {
  const route = await proxyRoute(service?.settings.proxy ?? '')
  if (!route) return fetch(input, init)
  type Args = Parameters<typeof route.fetch>
  return (await route.fetch(input as Args[0], { ...init, dispatcher: route.agent } as Args[1])) as unknown as Response
}

/**
 * Both sessions need the address: `net.fetch` sends through the default one, electron-updater through its own.
 * Closing the connections makes the change take effect now rather than once the pools idle.
 */
function applyChromiumProxy(setting: string): Promise<void> {
  const config = proxyConfig(setting)
  const sessions = [session.defaultSession, session.fromPartition('electron-updater', { cache: false })]
  return Promise.all(
    sessions.map((ses) =>
      ses
        .setProxy(config ?? { mode: 'system' })
        .then(() => ses.closeAllConnections())
        // The traffic stays on the old route; the window still shows what the player asked for.
        .catch((err) => log('Could not set the proxy:', err))
    )
  ).then(() => undefined)
}

const secretBox: SecretBox = {
  available: () => safeStorage.isEncryptionAvailable(),
  seal: (s) => safeStorage.encryptString(s).toString('base64'),
  open: (s) => safeStorage.decryptString(Buffer.from(s, 'base64'))
}

function contentSecurityPolicy(): string {
  if (DEV_URL) {
    // The dev server needs inline scripts (React refresh) and a websocket.
    return [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      `connect-src 'self' ws://localhost:* http://localhost:*`
    ].join('; ')
  }
  // The same policy as the meta tag in src/renderer/index.html (script and connect fall back to default-src).
  return ["default-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:"].join('; ')
}

const PAGE: AppPage = { devUrl: DEV_URL, indexHtml: path.join(__dirname, '../renderer/index.html') }

function isOurPage(url: string): boolean {
  return isOurPageUrl(url, PAGE)
}

function setUpSession(): void {
  const csp = contentSecurityPolicy()
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!isOurPage(details.url)) return callback({ responseHeaders: details.responseHeaders })
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

/** macOS shows one menu bar for the whole app; without it Cmd+Q, Cmd+C, Cmd+V and Cmd+A do nothing. */
function setUpMenu(): void {
  if (process.platform !== 'darwin') return
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
}

function applyAutoStart(settings: Settings): void {
  // A dev run would register the bare Electron binary.
  if (!app.isPackaged) return
  try {
    if (process.platform === 'linux') {
      // Inside an AppImage, execPath is its temporary mount; APPIMAGE is the file itself.
      updateLinuxAutostart(app.getPath('appData'), process.env.APPIMAGE ?? process.execPath, settings.startAtLogin, settings.minimizeToTray)
    } else {
      // macOS login items take no arguments, so the window always opens there.
      app.setLoginItemSettings({
        openAtLogin: settings.startAtLogin,
        ...(process.platform === 'win32' ? { path: process.execPath, args: settings.minimizeToTray ? [HIDDEN_ARG] : [], name: 'Spoken Manager' } : {})
      })
    }
  } catch (err) {
    log('Could not update startup settings:', err)
  }
}

function showWindow(): void {
  if (!service) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function trayIcon(): NativeImage {
  const icon = nativeImage.createFromPath(iconPath())
  // The menu bar draws the image at its own size.
  return process.platform === 'darwin' ? icon.resize({ width: 16, height: 16 }) : icon
}

function syncTray(enabled: boolean): void {
  if (!enabled) {
    tray?.destroy()
    tray = null
    return
  }
  if (!tray) {
    tray = new Tray(trayIcon())
    tray.setToolTip('Spoken Manager')
    tray.on('click', showWindow)
  }
  // Built on every call, so a language change relabels the menu without replacing the icon.
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('tray.show'), click: showWindow },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => app.quit() }
    ])
  )
}

function applySettings(settings: Settings, previous: Settings): void {
  if (settings.proxy !== previous.proxy) {
    proxyReady = applyChromiumProxy(settings.proxy)
  }
  const startupChanged = settings.startAtLogin !== previous.startAtLogin || settings.minimizeToTray !== previous.minimizeToTray
  const languageChanged = settings.uiLanguage !== previous.uiLanguage
  if (!startupChanged && !languageChanged) return
  if (startupChanged) applyAutoStart(settings)
  syncTray(settings.minimizeToTray)
}

function createWindow(startHidden = false): BrowserWindow {
  const chrome = windowChrome(process.platform)
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: BACKGROUND,
    show: false,
    title: 'Spoken Manager',
    icon: iconPath(),
    autoHideMenuBar: true,
    titleBarStyle: chrome.titleBarStyle,
    ...(chrome.frame === false ? { frame: false } : {}),
    ...(chrome.trafficLightPosition ? { trafficLightPosition: chrome.trafficLightPosition } : {}),
    // Windows and Linux: no system buttons, the page draws its own on the tab row (TopBar.tsx), because the
    // native overlay cannot be transparent or bigger. They call the window:* channels in ipc.ts.
    // macOS keeps the system buttons (inset into the tab row) and the page hides its own.
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  if (process.platform !== 'darwin') win.removeMenu()
  win.on('minimize', () => {
    if (service?.settings.minimizeToTray) win.hide()
  })
  win.on('maximize', () => win.webContents.send(CHANNELS.windowMaximized, true))
  win.on('unmaximize', () => win.webContents.send(CHANNELS.windowMaximized, false))

  win.once('ready-to-show', () => {
    if (!startHidden) win.show()
  })
  win.webContents.on('did-fail-load', (_e, code, description) => {
    log(`Window failed to load (${code}): ${description}`)
    if (!win.isDestroyed() && !startHidden) win.show()
  })

  // Links open in the browser, only when they are GitHub's; nothing opens a new window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The window shows its own page and nothing else: every other navigation, redirect or frame is blocked.
  const block = (event: { preventDefault: () => void }, url: string): void => {
    if (isOurPage(url)) return
    event.preventDefault()
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
  }
  win.webContents.on('will-navigate', block)
  win.webContents.on('will-redirect', block)
  win.webContents.on('will-frame-navigate', (details) => block(details, details.url))
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (DEV_URL) void win.loadURL(DEV_URL)
  else void win.loadFile(PAGE.indexHtml)
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Also the way back to a window hidden in the tray when the desktop shows no tray icons.
  app.on('second-instance', showWindow)

  // macOS apps stay open without a window (Cmd+Q quits, a click on the Dock icon opens the window again).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', showWindow)

  // Quitting with a job running: stop it and wait for its rollback first, so the quit (and an
  // update installed on quit) never lands in the middle of swapping folders.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting || !service || service.jobs.active().length === 0) return
    quitting = true
    event.preventDefault()
    log('Quit requested while a job is running: stopping it first.')
    void service.jobs
      .cancelAll()
      .catch((err) => log('Stopping jobs failed:', err))
      .finally(() => app.quit())
  })

  void app.whenReady().then(() => {
    const dataPath = app.getPath('userData')
    initLog(dataPath)
    log(`Spoken Manager ${app.getVersion()} starting (Electron ${process.versions.electron}).`)

    setUpSession()
    setUpMenu()
    // A dev build can send to a local site instead (SPOKEN_SHARE_URL); a packaged one never does.
    const shareUrl = app.isPackaged ? undefined : process.env.SPOKEN_SHARE_URL
    // Only a dev build may be pointed elsewhere: a packaged one must not be able to send a password to another host.
    const siteUrl = app.isPackaged ? undefined : process.env.SPOKEN_SITE_URL
    service = new ManagerService({
      dataPath,
      appVersion: app.getVersion(),
      send: broadcast,
      fetchImpl: chromiumFetch,
      // Node's fetch, because net.fetch cannot do this traffic: an Origin header makes it send a CORS preflight and
      // fail the request, and a Content-Length on a streamed upload is an invalid argument to it. Node's crash on a
      // held-back body needs a large response, and these answers are short.
      contributorFetch: nodeFetch,
      secretBox,
      ...(shareUrl ? { shareUrl } : {}),
      ...(siteUrl ? { siteUrl } : {}),
      settingsChanged: applySettings,
      // The manager's own update downloads outside `jobs`, and a proxy change would close its connections.
      busyElsewhere: managerUpdateOnTheWire
    })
    syncTray(service.settings.minimizeToTray)
    // Empty needs nothing: both sessions start on the system proxy. An unusable saved address was dropped on load.
    if (service.settings.proxy) proxyReady = applyChromiumProxy(service.settings.proxy)
    // Refreshes the login item's path, which an update or reinstall can move.
    if (service.settings.startAtLogin) applyAutoStart(service.settings)
    registerIpc(service, PAGE, () => updaterState)
    void service.init()
    service.startSharing()
    service.startPeriodicRefresh()

    mainWindow = createWindow(process.argv.includes(HIDDEN_ARG) && service.settings.minimizeToTray)

    const svc = service
    void startUpdater({
      isPackaged: app.isPackaged,
      appVersion: app.getVersion(),
      autoUpdateManager: () => svc.settings.autoUpdateManager,
      // Chromium's fetch, so the feed read follows the proxy too.
      fetchText: (url) => fetchWithLimit(url, chromiumFetch),
      // electron-updater sends through a session of its own, so it has to wait for the proxy separately.
      proxyReady: () => proxyReady,
      send: (state) => {
        updaterState = state
        broadcast(CHANNELS.updaterState, state)
      }
    })
  })
}

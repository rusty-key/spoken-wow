// Spoken Manager: main process. The network traffic is the GitHub release list, the voice pack
// server, the asset downloads and the manager's own update, plus, only when the player turned
// Sharing on, the lines Spoken collected, sent to spoken.rusty.one (share.ts).
import path from 'node:path'
import { app, BrowserWindow, Menu, net, session, shell } from 'electron'
import { CHANNELS, type UpdaterState } from '../shared/api'
import { windowChrome } from './chrome'
import { isAllowedExternalUrl } from './external'
import { registerIpc } from './ipc'
import { ManagerService } from './service'
import { initLog, log } from './state'
import { isOurPage as isOurPageUrl, type AppPage } from './trust'
import { startUpdater } from './updater'

app.setName('Spoken Manager')
if (process.platform === 'win32') app.setAppUserModelId('one.rusty.spoken.manager')

const BACKGROUND = '#16171d'
const DEV_URL = process.env.ELECTRON_RENDERER_URL

let service: ManagerService | null = null
let mainWindow: BrowserWindow | null = null
// Each state is sent once, so a window opened later (macOS, from the Dock) reads it from the snapshot.
let updaterState: UpdaterState = { state: 'idle' }

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

// Node's own fetch (undici) brings the whole main process down when a server closes the connection while a large
// body is held back because the disk write is slower (`assert(!this.paused)` in Parser.finish, uncaught). Chromium's
// network stack does not, and it also uses the system proxy. `no-store`: the packs are not worth a copy in its cache.
// `omit`: net.fetch would otherwise keep and resend cookies, and the Manager sends only the request and a User-Agent.
const chromiumFetch: typeof fetch = (input, init) =>
  net.fetch(input instanceof URL ? input.href : input, { ...init, cache: 'no-store', credentials: 'omit' })

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

function createWindow(): BrowserWindow {
  const chrome = windowChrome(process.platform)
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: BACKGROUND,
    show: false,
    title: 'Spoken Manager',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
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
  win.on('maximize', () => win.webContents.send(CHANNELS.windowMaximized, true))
  win.on('unmaximize', () => win.webContents.send(CHANNELS.windowMaximized, false))

  win.once('ready-to-show', () => win.show())
  win.webContents.on('did-fail-load', (_e, code, description) => {
    log(`Window failed to load (${code}): ${description}`)
    if (!win.isDestroyed()) win.show()
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
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  // macOS apps stay open without a window (Cmd+Q quits, a click on the Dock icon opens the window again).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (service && BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })

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
    service = new ManagerService({
      dataPath,
      appVersion: app.getVersion(),
      send: broadcast,
      fetchImpl: chromiumFetch,
      ...(shareUrl ? { shareUrl } : {})
    })
    registerIpc(service, PAGE, () => updaterState)
    void service.init()
    service.startSharing()

    mainWindow = createWindow()

    if (service.settings.checkOnStart) {
      void service.ready.then(() => service?.refreshCatalog(false)).catch((err) => log('Catalog refresh failed:', err))
      void service.ready.then(() => service?.refreshCommunity(false)).catch((err) => log('Community refresh failed:', err))
    }
    const svc = service
    void startUpdater({
      isPackaged: app.isPackaged,
      appVersion: app.getVersion(),
      autoUpdateManager: () => svc.settings.autoUpdateManager,
      send: (state) => {
        updaterState = state
        broadcast(CHANNELS.updaterState, state)
      }
    })
  })
}

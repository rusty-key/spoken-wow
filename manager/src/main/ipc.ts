// The handlers for every channel in shared/api.ts. Each argument is checked before it is used.
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { CHANNELS, type InstallOptions, type UpdaterState } from '../shared/api'
import type { Settings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'
import { isAllowedExternalUrl, openableDirectory } from './external'
import type { ManagerService } from './service'
import { isOurPage, type AppPage } from './trust'
import { log, logsDir } from './state'
import { checkForManagerUpdate } from './updater'

function text(v: unknown, what: string, max = 2048): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max || v.includes('\0')) throw new Error(`Invalid ${what}`)
  return v
}

function id(v: unknown, what: string): string {
  const s = text(v, what, 200)
  if (!/^[\w.-]+$/.test(s)) throw new Error(`Invalid ${what}`)
  return s
}

/** An official product id, or `community/<pack id>`. */
function productId(v: unknown): string {
  const s = text(v, 'product id', 80)
  if (!/^[\w.-]+$/.test(s) && !/^community\/[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) throw new Error('Invalid product id')
  return s
}

function settingsPatch(v: unknown): Partial<Settings> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Invalid settings')
  const out: Partial<Settings> = {}
  const raw = v as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(key in raw)) continue
    if (typeof raw[key] !== typeof DEFAULT_SETTINGS[key]) throw new Error(`Invalid setting ${key}`)
    if (typeof raw[key] === 'string' && ((raw[key] as string).length > 2000 || (raw[key] as string).includes('\0'))) throw new Error(`Invalid setting ${key}`)
    ;(out as Record<string, unknown>)[key] = raw[key]
  }
  return out
}

function installOptions(v: unknown): InstallOptions | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'object') throw new Error('Invalid options')
  const { version, repair } = v as { version?: unknown; repair?: unknown }
  if (repair !== undefined && typeof repair !== 'boolean') throw new Error('Invalid options')
  if (version !== undefined && (typeof version !== 'string' || version.length > 100 || !/^[\w.+-]+$/.test(version))) throw new Error('Invalid version')
  return { ...(typeof version === 'string' ? { version } : {}), ...(repair === true ? { repair } : {}) }
}

/** Only the window's own page, in its top frame, may call. */
function trusted(event: IpcMainInvokeEvent, page: AppPage): boolean {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) return false
  return isOurPage(frame.url, page)
}

export function registerIpc(service: ManagerService, page: AppPage, updater: () => UpdaterState): void {
  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event, page)) {
        log(`Blocked ${channel} from ${event.senderFrame?.url ?? 'an unknown frame'}`)
        throw new Error('Not allowed')
      }
      await service.ready
      try {
        return await fn(event, ...args)
      } catch (err) {
        log(`IPC ${channel} failed:`, err)
        throw err
      }
    })
  }

  // The window buttons must work even while the service is still starting, so they skip `service.ready`.
  const windowOf = (event: IpcMainInvokeEvent): BrowserWindow | null => {
    if (!trusted(event, page)) {
      log(`Blocked a window command from ${event.senderFrame?.url ?? 'an unknown frame'}`)
      throw new Error('Not allowed')
    }
    return BrowserWindow.fromWebContents(event.sender)
  }
  ipcMain.handle(CHANNELS.windowMinimize, (event) => void windowOf(event)?.minimize())
  ipcMain.handle(CHANNELS.windowToggleMaximize, (event) => {
    const win = windowOf(event)
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle(CHANNELS.windowClose, (event) => void windowOf(event)?.close())
  ipcMain.handle(CHANNELS.windowIsMaximized, (event) => windowOf(event)?.isMaximized() ?? false)

  handle(CHANNELS.snapshot, () => ({ ...service.snapshot(), updater: updater() }))
  handle(CHANNELS.scanGames, () => service.scan())
  handle(CHANNELS.addGame, (_e, p) => service.addGame(text(p, 'path')))
  handle(CHANNELS.removeGame, (_e, gameId) => service.removeGame(id(gameId, 'game id')))
  handle(CHANNELS.refreshCatalog, (_e, force) => service.refreshCatalog(force === true))
  handle(CHANNELS.refreshCommunity, (_e, force) => service.refreshCommunity(force === true))
  handle(CHANNELS.statuses, (_e, gameId) => service.statuses(id(gameId, 'game id')))
  handle(CHANNELS.install, (_e, gameId, pid, options) =>
    service.install(id(gameId, 'game id'), productId(pid), installOptions(options))
  )
  handle(CHANNELS.uninstall, (_e, gameId, pid) => service.uninstall(id(gameId, 'game id'), productId(pid)))
  handle(CHANNELS.cancel, (_e, jobId) => service.cancel(id(jobId, 'job id')))
  handle(CHANNELS.setSettings, (_e, patch) => service.setSettings(settingsPatch(patch)))

  handle(CHANNELS.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!
  })

  handle(CHANNELS.openPath, async (_e, p) => {
    const roots = [...service.games.map((g) => g.addOnsPath), service.dataPath, service.downloadsPath()]
    const target = await openableDirectory(text(p, 'path'), roots)
    const problem = await shell.openPath(target)
    if (problem) log('Could not open a folder:', problem)
  })

  handle(CHANNELS.openExternal, async (_e, url) => {
    if (!isAllowedExternalUrl(url)) throw new Error('That link cannot be opened from here')
    await shell.openExternal(url as string)
  })

  handle(CHANNELS.checkManagerUpdate, () => checkForManagerUpdate())
  handle(CHANNELS.clearDownloads, () => service.clearDownloads())
  handle(CHANNELS.shareNow, () => service.sendNow())
  handle(CHANNELS.resetShareId, () => service.resetShareId())
  handle(CHANNELS.generatePair, () => service.generatePair())
  handle(CHANNELS.generateUnpair, () => service.generateUnpair())
  handle(CHANNELS.generateSetKey, (_e, provider, key) => {
    if (provider !== 'elevenlabs' && provider !== 'fish') throw new Error('Invalid provider')
    if (typeof key !== 'string' || key.length > 512 || key.includes('\0')) throw new Error('Invalid key')
    return service.generateSetKey(provider, key)
  })

  handle(CHANNELS.openLogs, async () => {
    const problem = await shell.openPath(logsDir(service.dataPath))
    if (problem) log('Could not open the log folder:', problem)
  })
}

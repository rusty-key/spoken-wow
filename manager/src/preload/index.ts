import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type ManagerApi } from '../shared/api'

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: unknown, value: T): void => listener(value)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: ManagerApi = {
  snapshot: () => ipcRenderer.invoke(CHANNELS.snapshot),
  scanGames: () => ipcRenderer.invoke(CHANNELS.scanGames),
  addGame: (path) => ipcRenderer.invoke(CHANNELS.addGame, path),
  removeGame: (gameId) => ipcRenderer.invoke(CHANNELS.removeGame, gameId),
  refreshCatalog: (force) => ipcRenderer.invoke(CHANNELS.refreshCatalog, force),
  refreshCommunity: (force) => ipcRenderer.invoke(CHANNELS.refreshCommunity, force),
  statuses: (gameId) => ipcRenderer.invoke(CHANNELS.statuses, gameId),
  install: (gameId, productId, options) => ipcRenderer.invoke(CHANNELS.install, gameId, productId, options),
  uninstall: (gameId, productId) => ipcRenderer.invoke(CHANNELS.uninstall, gameId, productId),
  cancel: (jobId) => ipcRenderer.invoke(CHANNELS.cancel, jobId),
  setSettings: (patch) => ipcRenderer.invoke(CHANNELS.setSettings, patch),
  pickFolder: () => ipcRenderer.invoke(CHANNELS.pickFolder),
  openPath: (path) => ipcRenderer.invoke(CHANNELS.openPath, path),
  openExternal: (url) => ipcRenderer.invoke(CHANNELS.openExternal, url),
  openLogs: () => ipcRenderer.invoke(CHANNELS.openLogs),
  checkManagerUpdate: () => ipcRenderer.invoke(CHANNELS.checkManagerUpdate),
  clearDownloads: () => ipcRenderer.invoke(CHANNELS.clearDownloads),
  shareNow: () => ipcRenderer.invoke(CHANNELS.shareNow),
  resetShareId: () => ipcRenderer.invoke(CHANNELS.resetShareId),
  generatePair: () => ipcRenderer.invoke(CHANNELS.generatePair),
  generateUnpair: () => ipcRenderer.invoke(CHANNELS.generateUnpair),
  generateSetKey: (provider, key) => ipcRenderer.invoke(CHANNELS.generateSetKey, provider, key),
  windowMinimize: () => ipcRenderer.invoke(CHANNELS.windowMinimize),
  windowToggleMaximize: () => ipcRenderer.invoke(CHANNELS.windowToggleMaximize),
  windowClose: () => ipcRenderer.invoke(CHANNELS.windowClose),
  windowIsMaximized: () => ipcRenderer.invoke(CHANNELS.windowIsMaximized),
  onJob: (l) => listen(CHANNELS.jobProgress, l),
  onGamesChanged: (l) => listen(CHANNELS.gamesChanged, l),
  onCatalogChanged: (l) => listen(CHANNELS.catalogChanged, l),
  onCommunityChanged: (l) => listen(CHANNELS.communityChanged, l),
  onUpdater: (l) => listen(CHANNELS.updaterState, l),
  onSharing: (l) => listen(CHANNELS.sharingChanged, l),
  onGenerate: (l) => listen(CHANNELS.generateChanged, l),
  onWindowMaximized: (l) => listen(CHANNELS.windowMaximized, l)
}

// A file dropped on the window would make the browser open it; nothing here takes drops.
for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault(), true)

contextBridge.exposeInMainWorld('manager', api)

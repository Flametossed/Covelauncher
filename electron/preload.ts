import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  searchGame:                 (query: string) => ipcRenderer.invoke('search-game', query),
  getDownloadOptions:         (url: string, gameTitle?: string) => ipcRenderer.invoke('get-download-options', url, gameTitle),
  getDirectDownloadLink:      (url: string)   => ipcRenderer.invoke('get-direct-download-link', url),
  startDownload:  (id: string, url: string, referer: string, downloadDir: string, extract: boolean, gameTitle?: string, coverUrl?: string) =>
                              ipcRenderer.invoke('start-download', id, url, referer, downloadDir, extract, gameTitle, coverUrl),
  cancelDownload:             (id: string)    => ipcRenderer.invoke('cancel-download', id),
  pauseDownload:              (id: string)    => ipcRenderer.invoke('pause-download', id),
  resumeDownload:             (id: string)    => ipcRenderer.invoke('resume-download', id),
  fetchImage:                 (url: string)   => ipcRenderer.invoke('fetch-image', url),
  getLatestGames:             ()              => ipcRenderer.invoke('get-latest-games'),
  getPopularGames:            ()              => ipcRenderer.invoke('get-popular-games'),
  getLibrary:                 (dir: string)   => ipcRenderer.invoke('get-library', dir),
  openInExplorer:             (path: string)  => ipcRenderer.invoke('open-in-explorer', path),
  deleteLibraryItem:          (path: string)  => ipcRenderer.invoke('delete-library-item', path),
  selectDirectory:            ()              => ipcRenderer.invoke('select-directory'),
  onDownloadProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('download-progress', (_event, data) => callback(data));
  },
  removeDownloadProgressListener: () => {
    ipcRenderer.removeAllListeners('download-progress');
  },
  // Config/Sources management
  getConfig:                  ()              => ipcRenderer.invoke('get-config'),
  saveConfig:                 (config: any)   => ipcRenderer.invoke('save-config', config),
  clearConfig:                ()              => ipcRenderer.invoke('clear-config'),
  addSource:                  (source: any)   => ipcRenderer.invoke('add-source', source),
  removeSource:               (id: string)    => ipcRenderer.invoke('remove-source', id),
  // Emulator management
  addEmulator:                (emulator: any) => ipcRenderer.invoke('add-emulator', emulator),
  removeEmulator:             (id: string)    => ipcRenderer.invoke('remove-emulator', id),
  selectExecutable:           ()              => ipcRenderer.invoke('select-executable'),
  launchGame:                 (emulatorPath: string, gamePath: string, args: string) =>
                              ipcRenderer.invoke('launch-game', emulatorPath, gamePath, args),
  // Firmware / Keys management
  getFirmwareReleases:        ()              => ipcRenderer.invoke('get-firmware-releases'),
  getProdKeys:                ()              => ipcRenderer.invoke('get-prod-keys'),
});

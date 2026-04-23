/// <reference types="vite/client" />

interface ElectronAPI {
  searchGame:                     (query: string)    => Promise<any[]>;
  getDownloadOptions:             (url: string, gameTitle?: string) => Promise<any>;
  getDirectDownloadLink:          (url: string)      => Promise<string>;
  startDownload: (id: string, url: string, referer: string, downloadDir: string, extract: boolean, gameTitle?: string, coverUrl?: string) => Promise<string | null>;
  cancelDownload:                 (id: string)       => Promise<boolean>;
  pauseDownload:                  (id: string)       => Promise<boolean>;
  resumeDownload:                 (id: string)       => Promise<boolean>;
  fetchImage:                     (url: string)      => Promise<string>;
  getLatestGames:                 ()                 => Promise<any[]>;
  getPopularGames:                ()                 => Promise<any[]>;
  getLibrary:                     (dir: string)      => Promise<any[]>;
  openInExplorer:                 (path: string)     => Promise<void>;
  deleteLibraryItem:              (path: string)     => Promise<boolean>;
  selectDirectory:                ()                 => Promise<string | null>;
  onDownloadProgress:             (callback: (data: any) => void) => void;
  removeDownloadProgressListener: ()                 => void;
  // Config/Sources management
  getConfig:                      ()                 => Promise<any>;
  saveConfig:                     (config: any)      => Promise<any>;
  clearConfig:                    ()                 => Promise<any>;
  addSource:                      (source: any)      => Promise<any>;
  removeSource:                   (id: string)       => Promise<any>;
  // Emulator management
  addEmulator:                    (emulator: any)    => Promise<any>;
  removeEmulator:                 (id: string)       => Promise<any>;
  selectExecutable:               ()                 => Promise<string | null>;
  launchGame:                     (emulatorPath: string, gamePath: string, args: string) => Promise<{ success: boolean; error?: string }>;
  // Firmware management
  addFirmwareSource:              (firmware: any)    => Promise<any>;
  removeFirmwareSource:           (id: string)       => Promise<any>;
  getFirmwareReleases:            ()                 => Promise<{ version: string; name: string; downloadUrl: string; size: number; publishedAt: string }[]>;
  getProdKeys:                    ()                 => Promise<{ version: string; downloadUrl: string }>;
}

interface Window {
  electronAPI: ElectronAPI;
}

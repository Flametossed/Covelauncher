import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Download, Folder, FolderOpen, Play, RefreshCw, HardDrive,
  Settings, Pause, Square, X, RotateCcw, Trash2, ImageOff, CheckCircle,
  Moon, Sun, Plus, Cpu, Database, LayoutGrid, LayoutList
} from 'lucide-react';

interface GameResult {
  title: string;
  url: string;
  imageUrl?: string;
}

interface DownloadOption {
  name: string;
  url: string;
  size: string;
  format: string;
}

interface DownloadProgress {
  id: string;
  loaded: number;
  total: number;
  percentage: number;
  status: 'downloading' | 'paused' | 'extracting' | 'completed' | 'error' | 'cancelled';
  error?: string;
  fileName: string;
  contentType?: 'update' | 'dlc' | 'mod';
  optionName?: string;
}

function detectContentType(name: string): 'update' | 'dlc' | 'mod' | undefined {
  const n = name.toLowerCase();
  if (/\[upd\]|\bupdate\b|\bpatch\b/.test(n)) return 'update';
  if (/\[dlc\]|\bdlc\b/.test(n)) return 'dlc';
  if (/\[mod\]|\bmod\b/.test(n)) return 'mod';
  return undefined;
}

interface SourceConfig {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  selectors: any;
  paths: any;
}

interface EmulatorConfig {
  id: string;
  name: string;
  path: string;
  args: string;
  extensions: string[];
}

interface FirmwareSource {
  id: string;
  name: string;
  url: string;
  version: string;
}

interface AppConfig {
  sources: SourceConfig[];
  firmwareSources: FirmwareSource[];
  emulators: EmulatorConfig[];
}

type ActiveView = 'store' | 'library' | 'downloads' | 'settings' | 'firmware';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Lazily proxied image — fetches via main process to bypass CORS/Referer guards
function CoverImage({
  url,
  className,
  fallback
}: {
  url?: string;
  className?: string;
  fallback: React.ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url) { setFailed(true); return; }
    setSrc(null);
    setFailed(false);
    // Try direct load first (fastest); fall back to proxied fetch
    const img = new Image();
    img.onload  = () => setSrc(url);
    img.onerror = () => {
      // Proxy through main process
      if (window.electronAPI?.fetchImage) {
        window.electronAPI.fetchImage(url)
          .then(dataUrl => setSrc(dataUrl))
          .catch(() => setFailed(true));
      } else {
        setFailed(true);
      }
    };
    img.src = url;
  }, [url]);

  if (failed || (!src && !url)) return <>{fallback}</>;
  if (!src) {
    return (
      <div className={`${className} flex items-center justify-center bg-slate-900 animate-pulse`}>
        <div className="w-8 h-8 rounded-full bg-slate-700" />
      </div>
    );
  }
  return (
    <img
      src={src}
      className={`${className} object-cover`}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

interface FirmwareRelease {
  version: string;
  name: string;
  downloadUrl: string;
  size: number;
  publishedAt: string;
}

interface ProdKeyInfo {
  version: string;
  downloadUrl: string;
}

const FirmwarePage = ({ downloadDir, setDownloads }: { 
  downloadDir: string, 
  setDownloads: React.Dispatch<React.SetStateAction<{ [id: string]: DownloadProgress }>> 
}) => {
  const [releases, setReleases] = useState<FirmwareRelease[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [releaseError, setReleaseError] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');

  useEffect(() => {
    if (!window.electronAPI?.getFirmwareReleases) return;
    setLoadingReleases(true);
    setReleaseError('');
    window.electronAPI.getFirmwareReleases()
      .then((data: FirmwareRelease[]) => {
        setReleases(data);
        if (data.length > 0) setSelectedVersion(data[0].version);
      })
      .catch((err: any) => setReleaseError(err.message || 'Failed to fetch firmware releases'))
      .finally(() => setLoadingReleases(false));
  }, []);

  const [prodKeys, setProdKeys] = useState<ProdKeyInfo | null>(null);
  const [loadingProdKeys, setLoadingProdKeys] = useState(true);
  const [prodKeysError, setProdKeysError] = useState('');

  useEffect(() => {
    if (!window.electronAPI?.getProdKeys) return;
    setLoadingProdKeys(true);
    window.electronAPI.getProdKeys()
      .then((data: ProdKeyInfo) => setProdKeys(data))
      .catch((err: any) => setProdKeysError(err.message || 'Failed to fetch prod keys'))
      .finally(() => setLoadingProdKeys(false));
  }, []);

  const coveDir = downloadDir.replace(/[/\\][^/\\]*$/, '') || downloadDir;
  const firmwareDir = `${coveDir}/Firmware`;
  const keysDir = `${coveDir}/Keys`;

  const handleDownloadFirmware = async (release: FirmwareRelease) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(7);
    setDownloads(prev => ({
      ...prev,
      [id]: { id, loaded: 0, total: 0, percentage: 0, status: 'downloading', fileName: `Firmware ${release.version}.zip` }
    }));
    try {
      await window.electronAPI.startDownload(id, release.downloadUrl, release.downloadUrl, firmwareDir, false, `Firmware_${release.version}`, undefined);
    } catch (err: any) {
      if (err.message === 'Download cancelled') return;
      setDownloads(prev => ({ ...prev, [id]: { ...prev[id], status: 'error', error: err.message } }));
    }
  };

  const handleDownloadProdKeys = async (url: string, name: string) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(7);
    const fileName = url.split('/').pop() || 'prod.keys';
    setDownloads(prev => ({
      ...prev,
      [id]: { id, loaded: 0, total: 0, percentage: 0, status: 'downloading', fileName }
    }));
    try {
      await window.electronAPI.startDownload(id, url, 'https://prodkeys.net/', keysDir, true, name, undefined);
    } catch (err: any) {
      if (err.message === 'Download cancelled') return;
      setDownloads(prev => ({ ...prev, [id]: { ...prev[id], status: 'error', error: err.message } }));
    }
  };

  const latestRelease = releases[0];
  const selectedRelease = releases.find(r => r.version === selectedVersion);

  return (
    <div className="flex-1 overflow-auto p-8 max-w-2xl mx-auto w-full flex flex-col gap-6">
      <h2 className="text-2xl font-bold text-slate-100">Firmware</h2>

      {loadingReleases ? (
        <div className="flex flex-col items-center justify-center gap-4 text-slate-500 py-24">
          <RefreshCw className="w-12 h-12 text-blue-500 animate-spin" />
          <p className="text-lg font-medium">Fetching firmware versions...</p>
        </div>
      ) : releaseError ? (
        <div className="flex flex-col items-center justify-center gap-4 text-slate-500 py-24">
          <Cpu className="w-16 h-16 text-red-500/50" />
          <p className="text-lg font-medium text-red-400">Failed to load firmware</p>
          <p className="text-sm text-slate-500">{releaseError}</p>
        </div>
      ) : (
        <>
          {/* Download Latest Section */}
          {latestRelease && (
            <div className="bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-blue-500/30 rounded-2xl p-6 flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 bg-blue-500/20 rounded-xl flex items-center justify-center">
                  <Cpu className="w-7 h-7 text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-blue-400 font-semibold uppercase tracking-wider">Latest Version</div>
                  <div className="text-2xl font-bold text-slate-100">{latestRelease.version}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">Size</div>
                  <div className="text-sm text-slate-300 font-medium">{formatBytes(latestRelease.size)}</div>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleDownloadFirmware(latestRelease)}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 text-lg"
                >
                  <Download className="w-5 h-5" /> Download Latest
                </button>
                <button
                  onClick={() => window.electronAPI.openInExplorer(firmwareDir)}
                  className="px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors flex items-center justify-center"
                  title="Open folder"
                >
                  <FolderOpen className="w-5 h-5 text-slate-300" />
                </button>
              </div>
            </div>
          )}

          {/* Version Selector */}
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700/60">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">All Versions</h3>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div className="flex gap-3">
                <select
                  value={selectedVersion}
                  onChange={e => setSelectedVersion(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-slate-600 transition-colors cursor-pointer"
                >
                  {releases.map(r => (
                    <option key={r.version} value={r.version}>
                      {r.version} — {formatBytes(r.size)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => selectedRelease && handleDownloadFirmware(selectedRelease)}
                  disabled={!selectedRelease}
                  className="px-6 py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <Download className="w-4 h-4" /> Download
                </button>
                <button
                  onClick={() => window.electronAPI.openInExplorer(firmwareDir)}
                  className="px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors flex items-center justify-center"
                  title="Open folder"
                >
                  <FolderOpen className="w-4 h-4 text-slate-300" />
                </button>
              </div>
              <p className="text-xs text-slate-500">
                {releases.length} firmware version{releases.length !== 1 ? 's' : ''} available from THZoria/NX_Firmware
              </p>
            </div>
          </div>
        </>
      )}

      {/* Prod Keys Section */}
      <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700/60">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Download className="w-4 h-4" /> Prod Keys
          </h3>
        </div>
        <div className="p-6">
          {loadingProdKeys ? (
            <div className="flex items-center gap-3 text-slate-500">
              <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />
              <span className="text-sm">Fetching latest prod keys...</span>
            </div>
          ) : prodKeysError ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-red-400">Failed to load prod keys</p>
              <p className="text-xs text-slate-500">{prodKeysError}</p>
            </div>
          ) : prodKeys && prodKeys.downloadUrl ? (
            <div className="flex gap-3">
              <button
                onClick={() => handleDownloadProdKeys(prodKeys.downloadUrl, `prod.keys ${prodKeys.version}`)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-3 px-4 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4 text-blue-400" />
                Download {prodKeys.version}
              </button>
              <button
                onClick={() => window.electronAPI.openInExplorer(keysDir)}
                className="px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors flex items-center justify-center"
                title="Open folder"
              >
                <FolderOpen className="w-4 h-4 text-slate-300" />
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No download link found on prodkeys.net</p>
          )}
        </div>
      </div>
    </div>
  );
};

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  );

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const [activeView, setActiveView]       = useState<ActiveView>('store');
  const [query, setQuery]                 = useState('');
  const [games, setGames]                 = useState<GameResult[]>([]);
  const [hasSearched, setHasSearched]     = useState(false);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState('');
  const [libraryItems, setLibraryItems]   = useState<any[]>([]);

  const [latestGames, setLatestGames]     = useState<GameResult[]>([]);
  const [popularGames, setPopularGames]   = useState<GameResult[]>([]);
  const [homepageLoading, setHomepageLoading] = useState(true);

  const [selectedGame, setSelectedGame]   = useState<GameResult | null>(null);
  const [options, setOptions]             = useState<DownloadOption[]>([]);
  const [coverUrl, setCoverUrl]           = useState<string | undefined>();
  const [optionsLoading, setOptionsLoading] = useState(false);

  const [downloads, setDownloads] = useState<{ [id: string]: DownloadProgress }>({});
  const [downloadedNames, setDownloadedNames] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('downloadedNames') || '[]'))
  );

  const [downloadDir, setDownloadDir]   = useState<string>(
    () => localStorage.getItem('downloadDir') || 'C:\\Covedownloader\\ROMS'
  );
  const [autoExtract, setAutoExtract]   = useState<boolean>(
    () => localStorage.getItem('autoExtract') !== 'false'
  );

  const [appConfig, setAppConfig] = useState<AppConfig>({ sources: [], firmwareSources: [], emulators: [] });
  const [selectedEmulator, setSelectedEmulator] = useState<string>(
    () => localStorage.getItem('selectedEmulator') || ''
  );

  const activeCount = Object.values(downloads).filter(
    d => d.status === 'downloading' || d.status === 'paused' || d.status === 'extracting'
  ).length;

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onDownloadProgress((data: DownloadProgress) => {
        setDownloads(prev => {
          const merged = { ...prev[data.id], ...data };
          if (data.status === 'completed' && merged.optionName) {
            setDownloadedNames(names => {
              const next = new Set(names);
              next.add(merged.optionName!);
              localStorage.setItem('downloadedNames', JSON.stringify([...next]));
              return next;
            });
          }
          return { ...prev, [data.id]: merged };
        });
        if (data.status === 'completed') {
          window.electronAPI.getLibrary(downloadDir).then(setLibraryItems).catch(console.error);
        }
      });
      return () => window.electronAPI.removeDownloadProgressListener();
    }
  }, [downloadDir]);

  // Load library
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getLibrary(downloadDir).then(setLibraryItems).catch(console.error);
    }
  }, [downloadDir, activeView, selectedGame]);

  // Load homepage sections on mount
  useEffect(() => {
    if (!window.electronAPI) return;
    setHomepageLoading(true);
    Promise.all([
      window.electronAPI.getLatestGames().catch(() => []),
      window.electronAPI.getPopularGames().catch(() => [])
    ]).then(([latest, popular]) => {
      setLatestGames(latest);
      setPopularGames(popular);
      setHomepageLoading(false);
    });
  }, [appConfig.sources]);

  // Load app config (sources, emulators, firmware)
  useEffect(() => {
    if (!window.electronAPI?.getConfig) return;
    window.electronAPI.getConfig().then(setAppConfig).catch(console.error);
  }, []);

  // Save selected emulator to localStorage
  useEffect(() => {
    localStorage.setItem('selectedEmulator', selectedEmulator);
  }, [selectedEmulator]);

  const handleLaunchGame = async (gamePath: string) => {
    const emulator = appConfig.emulators.find(e => e.id === selectedEmulator);
    if (!emulator) {
      alert('Please select an emulator in Settings first.');
      return;
    }
    const result = await window.electronAPI.launchGame(emulator.path, gamePath, emulator.args);
    if (!result.success) {
      alert('Failed to launch game: ' + result.error);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !window.electronAPI) return;
    setLoading(true);
    setError('');
    setHasSearched(true);
    setSelectedGame(null);
    setOptions([]);
    setCoverUrl(undefined);
    try {
      const results = await window.electronAPI.searchGame(query);
      setGames(results);
      if (results.length === 0) setError('No games found.');
    } catch (err: any) {
      setError(err.message || 'Error searching for games');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectGame = async (game: GameResult) => {
    setSelectedGame(game);
    setCoverUrl(game.imageUrl); // Show thumbnail immediately while full cover loads
    setOptionsLoading(true);
    setError('');
    try {
      const data = await window.electronAPI.getDownloadOptions(game.url, game.title);
      setOptions(data.options ?? data); // backwards compat
      if (data.coverUrl) setCoverUrl(data.coverUrl);
    } catch (err: any) {
      setError(err.message || 'Error fetching download options');
    } finally {
      setOptionsLoading(false);
    }
  };

  const handleDownload = async (option: DownloadOption) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(7);
    const contentType = detectContentType(option.name);
    setDownloads(prev => ({
      ...prev,
      [id]: { id, loaded: 0, total: 0, percentage: 0, status: 'downloading', fileName: option.name, contentType, optionName: option.url }
    }));
    try {
      const directLink = await window.electronAPI.getDirectDownloadLink(option.url);
      const gameDir = autoExtract
        ? `${downloadDir}\\${selectedGame?.title.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        : downloadDir;
      await window.electronAPI.startDownload(id, directLink, option.url, gameDir, autoExtract, selectedGame?.title, coverUrl);
    } catch (err: any) {
      if (err.message === 'Download cancelled') return;
      console.error(err);
      setDownloads(prev => ({ ...prev, [id]: { ...prev[id], status: 'error', error: err.message } }));
    }
  };

  const handlePause   = useCallback(async (id: string) => {
    if (!window.electronAPI) return;
    if (await window.electronAPI.pauseDownload(id))
      setDownloads(prev => ({ ...prev, [id]: { ...prev[id], status: 'paused' } }));
  }, []);

  const handleResume  = useCallback(async (id: string) => {
    if (!window.electronAPI) return;
    if (await window.electronAPI.resumeDownload(id))
      setDownloads(prev => ({ ...prev, [id]: { ...prev[id], status: 'downloading' } }));
  }, []);

  const handleCancel  = useCallback(async (id: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.cancelDownload(id);
    setDownloads(prev => ({ ...prev, [id]: { ...prev[id], status: 'cancelled' } }));
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setDownloads(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  const handleClearCompleted = () => {
    setDownloads(prev => {
      const n = { ...prev };
      Object.keys(n).forEach(id => {
        if (['completed', 'error', 'cancelled'].includes(n[id].status)) delete n[id];
      });
      return n;
    });
  };

  // ─── Shared download card ────────────────────────────────────────────────
  const DownloadCard = ({ dl }: { dl: DownloadProgress }) => {
    const isActive = dl.status === 'downloading' || dl.status === 'extracting';
    const isPaused = dl.status === 'paused';
    const isDone   = dl.status === 'completed' || dl.status === 'error' || dl.status === 'cancelled';

    const statusColors: Record<DownloadProgress['status'], string> = {
      completed:   'bg-emerald-500/20 text-emerald-400',
      error:       'bg-red-500/20 text-red-400',
      cancelled:   'bg-slate-600/40 text-slate-400',
      paused:      'bg-yellow-500/20 text-yellow-400',
      extracting:  'bg-purple-500/20 text-purple-400',
      downloading: 'bg-blue-500/20 text-blue-400',
    };
    const barColors: Record<DownloadProgress['status'], string> = {
      completed:   'bg-emerald-500',
      error:       'bg-red-500',
      cancelled:   'bg-slate-600',
      paused:      'bg-yellow-500',
      extracting:  'bg-purple-500',
      downloading: 'bg-blue-500',
    };
    const statusLabel = {
      completed:   'Done',
      error:       'Error',
      cancelled:   'Cancelled',
      paused:      'Paused',
      extracting:  'Extracting...',
      downloading: `${dl.percentage}%`,
    }[dl.status];

    return (
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {dl.contentType === 'update' && (
                <span className="shrink-0 text-xs px-1.5 py-0.5 rounded font-semibold bg-amber-500/20 text-amber-400">UPDATE</span>
              )}
              {dl.contentType === 'dlc' && (
                <span className="shrink-0 text-xs px-1.5 py-0.5 rounded font-semibold bg-cyan-500/20 text-cyan-400">DLC</span>
              )}
              {dl.contentType === 'mod' && (
                <span className="shrink-0 text-xs px-1.5 py-0.5 rounded font-semibold bg-rose-500/20 text-rose-400">MOD</span>
              )}
              <div className="font-medium text-slate-200 truncate" title={dl.fileName}>{dl.fileName}</div>
            </div>
            {(isActive || isPaused) && dl.total > 0 && (
              <div className="text-xs text-slate-500 mt-0.5">
                {formatBytes(dl.loaded)} / {formatBytes(dl.total)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded font-semibold ${statusColors[dl.status]}`}>
              {statusLabel}
            </span>
            {isActive && (
              <button onClick={() => handlePause(dl.id)} title="Pause"
                className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-yellow-400 transition-colors">
                <Pause className="w-3.5 h-3.5" />
              </button>
            )}
            {isPaused && (
              <button onClick={() => handleResume(dl.id)} title="Resume"
                className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-blue-400 transition-colors">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
            {(isActive || isPaused) && (
              <button onClick={() => handleCancel(dl.id)} title="Cancel"
                className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-red-400 transition-colors">
                <Square className="w-3.5 h-3.5" />
              </button>
            )}
            {isDone && (
              <button onClick={() => handleDismiss(dl.id)} title="Dismiss"
                className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
          <div className={`h-1.5 rounded-full transition-all duration-300 ${barColors[dl.status]}`}
               style={{ width: `${dl.percentage}%` }} />
        </div>
        {dl.error && <div className="text-xs text-red-400">{dl.error}</div>}
      </div>
    );
  };

  // ─── Downloads page ──────────────────────────────────────────────────────
  const DownloadsPage = () => {
    const all      = Object.values(downloads);
    const active   = all.filter(d => ['downloading','paused','extracting'].includes(d.status));
    const finished = all.filter(d => ['completed','error','cancelled'].includes(d.status));
    return (
      <div className="flex-1 overflow-auto p-8 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-100">Downloads</h2>
          {finished.length > 0 && (
            <button onClick={handleClearCompleted}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-800">
              <Trash2 className="w-4 h-4" /> Clear finished
            </button>
          )}
        </div>
        {all.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 text-slate-500 py-24">
            <Download className="w-16 h-16 text-slate-700" />
            <p className="text-lg font-medium">No downloads yet</p>
            <p className="text-sm">Go to the Catalogue and start downloading a game.</p>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Active ({active.length})
                </h3>
                {active.map(dl => <DownloadCard key={dl.id} dl={dl} />)}
              </section>
            )}
            {finished.length > 0 && (
              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  History ({finished.length})
                </h3>
                {finished.map(dl => <DownloadCard key={dl.id} dl={dl} />)}
              </section>
            )}
          </>
        )}
      </div>
    );
  };


  const handleSaveSettings = (dir: string, extract: boolean) => {
    setDownloadDir(dir);
    setAutoExtract(extract);
    localStorage.setItem('downloadDir', dir);
    localStorage.setItem('autoExtract', String(extract));
  };



  // ─── Horizontal scroll row (used on homepage) ───────────────────────────
  const GameRow = ({ games: rowGames, loading: rowLoading }: { games: GameResult[], loading?: boolean }) => {
    if (rowLoading) {
      return (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shrink-0 w-36 rounded-xl overflow-hidden border border-slate-700/50 bg-slate-800/50 animate-pulse">
              <div className="w-36 h-48 bg-slate-700/40" />
              <div className="p-2.5"><div className="h-3 bg-slate-700/40 rounded w-4/5" /></div>
            </div>
          ))}
        </div>
      );
    }
    if (rowGames.length === 0) {
      return <p className="text-slate-500 text-sm py-2">Nothing to show right now.</p>;
    }
    return (
      <div className="flex gap-4 overflow-x-auto pb-2"
           style={{ scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}>
        {rowGames.map((game, i) => (
          <div key={i}
            className="shrink-0 w-36 group bg-slate-800/80 border border-slate-700 hover:border-blue-500/50
                       rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:shadow-blue-500/10"
            onClick={() => handleSelectGame(game)}>
            <div className="w-36 h-48 bg-slate-900 flex items-center justify-center overflow-hidden">
              <CoverImage url={game.imageUrl} className="w-full h-full"
                fallback={
                  <div className="flex items-center justify-center w-full h-full">
                    <Play className="w-8 h-8 text-slate-600 group-hover:text-blue-500 transition-colors" />
                  </div>
                } />
            </div>
            <div className="p-2.5 border-t border-slate-700/60">
              <h3 className="text-xs font-semibold leading-tight line-clamp-2 text-slate-300
                             group-hover:text-slate-50 transition-colors">
                {game.title}
              </h3>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // ─── Library page ────────────────────────────────────────────────────────
  const LibraryPage = () => {
    const [librarySort, setLibrarySort] = useState<'name_asc' | 'name_desc' | 'newest' | 'oldest'>('newest');
    const [libraryView, setLibraryView] = useState<'compact' | 'detailed'>('detailed');

    const sortedLibrary = [...libraryItems].sort((a, b) => {
      if (librarySort === 'name_asc') return a.name.localeCompare(b.name);
      if (librarySort === 'name_desc') return b.name.localeCompare(a.name);
      if (librarySort === 'newest') return (b.mtimeMs || 0) - (a.mtimeMs || 0);
      if (librarySort === 'oldest') return (a.mtimeMs || 0) - (b.mtimeMs || 0);
      return 0;
    });

    const getComponents = (item: any): string[] => {
      const safeItem = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return [...downloadedNames].filter(n => {
        const safe = n.toLowerCase().replace(/[^a-z0-9]/g, '');
        return safe.includes(safeItem) && detectContentType(n) !== undefined;
      });
    };

    const deleteItem = (item: any) => {
      if (window.confirm(`Delete "${item.name}" from your library? This will delete the file from your computer.`)) {
        if (window.electronAPI) {
          window.electronAPI.deleteLibraryItem(item.path)
            .then(() => window.electronAPI.getLibrary(downloadDir).then(setLibraryItems))
            .catch((err: any) => alert('Failed to delete item: ' + err.message));
        }
      }
    };

    const typeBadge = (name: string) => {
      const t = detectContentType(name);
      if (t === 'update') return <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-500/20 text-amber-400">UPDATE</span>;
      if (t === 'dlc')    return <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-cyan-500/20 text-cyan-400">DLC</span>;
      if (t === 'mod')    return <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-rose-500/20 text-rose-400">MOD</span>;
      return null;
    };

    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-8 flex flex-col gap-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-2xl font-bold text-slate-100">My Library</h2>
            {libraryItems.length > 0 && (
              <div className="flex items-center gap-3">
                <label className="text-sm text-slate-400">Sort by:</label>
                <select
                  value={librarySort}
                  onChange={(e) => setLibrarySort(e.target.value as any)}
                  className="bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-slate-600 transition-colors cursor-pointer"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="name_asc">Name (A-Z)</option>
                  <option value="name_desc">Name (Z-A)</option>
                </select>
                <div className="flex rounded-lg overflow-hidden border border-slate-700">
                  <button
                    onClick={() => setLibraryView('compact')}
                    title="Compact view"
                    className={`p-2 transition-colors ${libraryView === 'compact' ? 'bg-slate-600 text-slate-100' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                  ><LayoutGrid className="w-4 h-4" /></button>
                  <button
                    onClick={() => setLibraryView('detailed')}
                    title="Detailed view"
                    className={`p-2 transition-colors ${libraryView === 'detailed' ? 'bg-slate-600 text-slate-100' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                  ><LayoutList className="w-4 h-4" /></button>
                </div>
              </div>
            )}
          </div>

          {libraryItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 text-slate-500 py-24">
              <FolderOpen className="w-16 h-16 text-slate-700" />
              <p className="text-lg font-medium">Your library is empty</p>
              <p className="text-sm">Downloaded games will appear here.</p>
            </div>
          ) : libraryView === 'compact' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
              {sortedLibrary.map((item, i) => (
                <div key={i}
                  className="group bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden hover:border-slate-500 transition-colors cursor-pointer"
                  onClick={() => { if (window.electronAPI) window.electronAPI.openInExplorer(item.path); }}>
                  <div className="w-full aspect-[3/4] bg-slate-900 flex items-center justify-center overflow-hidden relative">
                    <CoverImage url={item.coverPath ? `file://${item.coverPath}` : undefined} className="w-full h-full"
                      fallback={
                        <div className="flex flex-col items-center gap-2 text-slate-700">
                          {item.type === 'directory' ? <Folder className="w-12 h-12" /> : <HardDrive className="w-12 h-12" />}
                        </div>
                      }
                    />
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {selectedEmulator && (
                        <button onClick={(e) => { e.stopPropagation(); handleLaunchGame(item.path); }}
                          className="p-1.5 bg-emerald-500/90 text-white rounded hover:bg-emerald-600 shadow" title="Launch">
                          <Play className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); deleteItem(item); }}
                        className="p-1.5 bg-red-500/90 text-white rounded hover:bg-red-600 shadow" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="p-3 border-t border-slate-700/60 bg-slate-800">
                    <h3 className="font-semibold text-xs leading-tight line-clamp-2 text-slate-200" title={item.name}>{item.name}</h3>
                    {item.type === 'file' && item.size > 0 && (
                      <p className="text-[10px] text-slate-500 mt-1">{formatBytes(item.size)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {sortedLibrary.map((item, i) => {
                const components = getComponents(item);
                return (
                  <div key={i} className="group bg-slate-800/80 border border-slate-700 rounded-xl overflow-hidden hover:border-slate-600 transition-colors flex gap-4 p-4">
                    <div
                      className="w-16 shrink-0 rounded-lg overflow-hidden bg-slate-900 cursor-pointer self-start"
                      style={{ aspectRatio: '3/4' }}
                      onClick={() => { if (window.electronAPI) window.electronAPI.openInExplorer(item.path); }}
                    >
                      <CoverImage url={item.coverPath ? `file://${item.coverPath}` : undefined} className="w-full h-full"
                        fallback={
                          <div className="w-full h-full flex items-center justify-center text-slate-700">
                            {item.type === 'directory' ? <Folder className="w-8 h-8" /> : <HardDrive className="w-8 h-8" />}
                          </div>
                        }
                      />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-slate-100 leading-tight" title={item.name}>{item.name}</h3>
                        <div className="flex gap-1.5 shrink-0">
                          {selectedEmulator && (
                            <button onClick={() => handleLaunchGame(item.path)}
                              className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/40 transition-colors" title="Launch">
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => deleteItem(item)}
                            className="p-1.5 bg-red-500/20 text-red-400 rounded hover:bg-red-500/40 transition-colors" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {item.type === 'file' && item.size > 0 && (
                        <p className="text-xs text-slate-500">{formatBytes(item.size)}</p>
                      )}
                      {components.length > 0 ? (
                        <div className="flex flex-col gap-1.5 mt-1">
                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Add-ons</p>
                          {components.map((comp, j) => (
                            <div key={j} className="flex items-center gap-2 text-xs text-slate-400">
                              {typeBadge(comp)}
                              <span className="truncate" title={comp}>{comp}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600 mt-1">No add-ons downloaded</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Store page ──────────────────────────────────────────────────────────
  const StorePage = () => {
    const hasEnabledSources = appConfig.sources.some(s => s.enabled);
    const scrollRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      scrollRef.current?.scrollTo({ top: 0 });
    }, [selectedGame]);

    return (
    <div ref={scrollRef} className="flex-1 overflow-auto p-8 flex flex-col gap-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg">{error}</div>
      )}
      
      {!hasEnabledSources && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-4 py-3 rounded-lg flex items-center justify-between">
          <span className="font-medium">You don't have any sources enabled. Please add a source configuration to search and download games.</span>
          <button onClick={() => setActiveView('settings')} className="text-amber-300 hover:text-amber-200 underline text-sm shrink-0">
            Go to Settings
          </button>
        </div>
      )}

      {/* Active downloads banner */}
      {activeCount > 0 && (
        <button onClick={() => setActiveView('downloads')}
          className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 px-4 py-3 rounded-lg hover:bg-blue-500/20 transition-colors text-sm w-full text-left">
          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
          <span className="font-medium">{activeCount} download{activeCount > 1 ? 's' : ''} in progress</span>
          <span className="ml-auto text-xs underline">View all →</span>
        </button>
      )}

      {!selectedGame ? (
        <>
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : hasSearched ? (
            /* Search results grid */
            <div className="flex flex-col gap-5">
            <button
              onClick={() => { setHasSearched(false); setGames([]); setQuery(''); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 hover:text-white text-sm font-medium transition-colors w-fit sticky top-0 z-10">
              ← Back to home
            </button>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {games.map((game, i) => (
                <div key={i}
                  className="group bg-slate-800/80 border border-slate-700 hover:border-blue-500/50 rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:shadow-blue-500/10 flex flex-col"
                  onClick={() => handleSelectGame(game)}>
                  <div className="w-full aspect-[3/4] bg-slate-900 flex items-center justify-center overflow-hidden">
                    <CoverImage url={game.imageUrl} className="w-full h-full"
                      fallback={
                        <div className="flex flex-col items-center gap-2 text-slate-700">
                          <Play className="w-10 h-10 group-hover:text-blue-500 transition-colors" />
                        </div>
                      }
                    />
                  </div>
                  <div className="p-3 border-t border-slate-700/60">
                    <h3 className="font-semibold text-sm leading-tight line-clamp-2 text-slate-200
                                   group-hover:text-slate-50 transition-colors">
                      {game.title}
                    </h3>
                  </div>
                </div>
              ))}
            </div>
            </div>
          ) : (
            /* ── Homepage ─────────────────────────────────────────────── */
            <div className="flex flex-col gap-10">
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                    <span className="w-1 h-5 bg-blue-500 rounded-full inline-block" />
                    Latest ROMs
                  </h2>
                  <span className="text-xs text-slate-500">Recently added</span>
                </div>
                <GameRow games={latestGames} loading={homepageLoading} />
              </section>

              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                    <span className="w-1 h-5 bg-purple-500 rounded-full inline-block" />
                    Popular ROMs
                  </h2>
                  <span className="text-xs text-slate-500">Most downloaded</span>
                </div>
                <GameRow games={popularGames} loading={homepageLoading} />
              </section>
            </div>
          )}
        </>
      ) : (
        /* Game detail */
        <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
          <button onClick={() => setSelectedGame(null)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-200 hover:text-white text-sm font-medium transition-colors w-fit sticky top-0 z-10">
            ← Back to results
          </button>

          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 flex flex-col md:flex-row gap-8 items-start">
            {/* Cover art panel */}
            <div className="w-48 shrink-0 rounded-xl overflow-hidden border border-slate-700 bg-slate-900
                            flex items-center justify-center" style={{ minHeight: '256px' }}>
              <CoverImage
                url={coverUrl}
                className="w-full h-full"
                fallback={
                  <div className="w-48 h-64 flex flex-col items-center justify-center gap-2 text-slate-700">
                    <HardDrive className="w-14 h-14" />
                    <ImageOff className="w-6 h-6" />
                  </div>
                }
              />
            </div>

            <div className="flex-1 w-full">
              <h2 className="text-3xl font-bold mb-6">{selectedGame.title}</h2>
              

              {optionsLoading ? (
                <div className="flex items-center gap-3 text-slate-400 py-4">
                  <RefreshCw className="w-5 h-5 animate-spin" /> Fetching download links...
                </div>
              ) : options.length > 0 ? (
                <div className="flex flex-col gap-3 mt-4">
                  <h3 className="text-lg font-semibold text-slate-300 mb-2 border-b border-slate-700 pb-2">
                    Available Downloads
                  </h3>
                  {options.map((opt, i) => {
                    const alreadyDownloaded = downloadedNames.has(opt.url);
                    return (
                    <div key={i} className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-4
                                            border rounded-xl transition-colors gap-4 ${
                                              alreadyDownloaded
                                                ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10'
                                                : 'bg-slate-900/50 border-slate-700/50 hover:bg-slate-800'
                                            }`}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {alreadyDownloaded && <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />}
                          <div className="font-medium text-slate-200">{opt.name}</div>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-semibold">
                          <span className={`px-2 py-1 rounded bg-slate-800 border ${
                            opt.format.includes('NSP') ? 'border-blue-500/30 text-blue-400' :
                            opt.format.includes('XCI') ? 'border-purple-500/30 text-purple-400' :
                            'border-slate-600 text-slate-400'
                          }`}>{opt.format}</span>
                          <span className="text-slate-400 bg-slate-800 px-2 py-1 rounded">
                            Size: {opt.size}
                          </span>
                          {alreadyDownloaded && (
                            <span className="text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">Downloaded</span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => handleDownload(opt)}
                        className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-lg
                                   font-medium transition-colors flex items-center gap-2">
                        <Download className="w-4 h-4" /> Download
                      </button>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-slate-400 py-4">No direct download links found.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )};

  // ─── Settings page ───────────────────────────────────────────────────────
  const SettingsPage = () => {
    const [localDir,     setLocalDir]     = useState(downloadDir);
    const [localExtract, setLocalExtract] = useState(autoExtract);
    const [saved,        setSaved]        = useState(false);

    const [showAddEmulator, setShowAddEmulator] = useState(false);
    const [newEmulatorName, setNewEmulatorName] = useState('');
    const [newEmulatorPath, setNewEmulatorPath] = useState('');
    const [newEmulatorArgs, setNewEmulatorArgs] = useState('');

    const [showAddSource, setShowAddSource] = useState(false);

    const browse = async () => {
      if (!window.electronAPI) return;
      const chosen = await window.electronAPI.selectDirectory();
      if (chosen) setLocalDir(chosen);
    };

    const browseEmulator = async () => {
      if (!window.electronAPI) return;
      const chosen = await window.electronAPI.selectExecutable();
      if (chosen) setNewEmulatorPath(chosen);
    };

    const addNewEmulator = async () => {
      if (!newEmulatorName.trim() || !newEmulatorPath.trim()) return;
      const emulator: EmulatorConfig = {
        id: Date.now().toString(),
        name: newEmulatorName.trim(),
        path: newEmulatorPath.trim(),
        args: newEmulatorArgs.trim(),
        extensions: ['nsp', 'xci', 'nro']
      };
      const newConfig = await window.electronAPI.addEmulator(emulator);
      setAppConfig(newConfig);
      setShowAddEmulator(false);
      setNewEmulatorName('');
      setNewEmulatorPath('');
      setNewEmulatorArgs('');
    };

    const removeEmulatorHandler = async (id: string) => {
      if (!window.confirm('Remove this emulator?')) return;
      const newConfig = await window.electronAPI.removeEmulator(id);
      setAppConfig(newConfig);
      if (selectedEmulator === id) setSelectedEmulator('');
    };

    const addNewSource = async (jsonString: string) => {
      try {
        const source = JSON.parse(jsonString);
        if (!source.id || !source.name || !source.baseUrl) {
          alert('Source must have id, name, and baseUrl');
          return;
        }
        source.enabled = source.enabled !== false;
        const newConfig = await window.electronAPI.addSource(source);
        setAppConfig(newConfig);
        setShowAddSource(false);
      } catch (e) {
        alert('Invalid JSON: ' + (e as Error).message);
      }
    };

    const handleSourceFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) addNewSource(content);
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    const removeSourceHandler = async (id: string) => {
      if (!window.confirm('Remove this source?')) return;
      const newConfig = await window.electronAPI.removeSource(id);
      setAppConfig(newConfig);
    };

    const save = () => {
      handleSaveSettings(localDir, localExtract);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    };

    return (
      <div className="flex-1 min-h-0 overflow-y-auto"><div className="p-8 max-w-2xl mx-auto w-full flex flex-col gap-6">
        <h2 className="text-2xl font-bold text-slate-100">Settings</h2>

        {/* Downloads section */}
        <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/60">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Downloads</h3>
          </div>

          <div className="p-6 flex flex-col gap-6">
            {/* Download directory */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-300">Download Directory</label>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2.5 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 min-w-0">
                  <Folder className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-sm text-slate-300 font-mono truncate" title={localDir}>
                    {localDir}
                  </span>
                </div>
                <button
                  onClick={browse}
                  className="shrink-0 bg-slate-700 hover:bg-slate-600 text-slate-200 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <FolderOpen className="w-4 h-4" />
                  Browse...
                </button>
              </div>
              <p className="text-xs text-slate-500">All downloaded ROMs will be saved to this folder.</p>
            </div>

            {/* Auto-extract toggle */}
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm font-semibold text-slate-300">Auto-extract archives</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Automatically unpack .zip / .rar files after download completes
                </div>
              </div>
              <button
                onClick={() => setLocalExtract(v => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors ${
                  localExtract ? 'bg-blue-600' : 'bg-slate-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    localExtract ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Emulators section */}
        <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/60 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Cpu className="w-4 h-4" /> Emulators <span className="normal-case font-normal text-slate-600 tracking-normal">(WIP coming soon!)</span>
            </h3>
            <button
              onClick={() => setShowAddEmulator(!showAddEmulator)}
              className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>

          <div className="p-6 flex flex-col gap-4">
            {showAddEmulator && (
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Emulator Name (e.g., Yuzu, Ryujinx)"
                  value={newEmulatorName}
                  onChange={e => setNewEmulatorName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Path to executable"
                    value={newEmulatorPath}
                    onChange={e => setNewEmulatorPath(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
                  />
                  <button
                    onClick={browseEmulator}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
                  >
                    Browse
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Launch arguments (optional, e.g., -f for fullscreen)"
                  value={newEmulatorArgs}
                  onChange={e => setNewEmulatorArgs(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowAddEmulator(false)}
                    className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addNewEmulator}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium"
                  >
                    Add Emulator
                  </button>
                </div>
              </div>
            )}

            {appConfig.emulators.length === 0 ? (
              <p className="text-slate-500 text-sm">No emulators configured. Add one to launch games directly.</p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-semibold text-slate-300">Default Emulator</label>
                  <select
                    value={selectedEmulator}
                    onChange={e => setSelectedEmulator(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select emulator...</option>
                    {appConfig.emulators.map(emu => (
                      <option key={emu.id} value={emu.id}>{emu.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2 mt-2">
                  {appConfig.emulators.map(emu => (
                    <div key={emu.id} className="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-200">{emu.name}</div>
                        <div className="text-xs text-slate-500 truncate" title={emu.path}>{emu.path}</div>
                      </div>
                      <button
                        onClick={() => removeEmulatorHandler(emu.id)}
                        className="p-1.5 text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        {/* Sources section */}
        <section className="bg-slate-800/60 border border-slate-700/60 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/60 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Database className="w-4 h-4" /> Sources
            </h3>
            <button
              onClick={() => setShowAddSource(!showAddSource)}
              className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add JSON
            </button>
          </div>

          <div className="p-6 flex flex-col gap-4">
            {showAddSource && (
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 flex flex-col gap-3">
                <p className="text-xs text-slate-400">Select a source configuration JSON file:</p>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleSourceFileUpload}
                  className="w-full text-sm text-slate-200 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowAddSource(false)}
                    className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {appConfig.sources.length === 0 ? (
              <p className="text-slate-500 text-sm">No sources configured.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {appConfig.sources.map(src => (
                  <div key={src.id} className="flex items-center justify-between bg-slate-900 border border-slate-700 rounded-lg px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-200">{src.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${src.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/40 text-slate-400'}`}>
                          {src.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 truncate" title={src.baseUrl}>{src.baseUrl}</div>
                    </div>
                    <button
                      onClick={() => removeSourceHandler(src.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="text-emerald-400 text-sm flex items-center gap-1.5 animate-pulse">
              <CheckCircle className="w-4 h-4" /> Saved!
            </span>
          )}
          <button
            onClick={save}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-xl font-semibold transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div></div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-900 text-slate-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-slate-50 tracking-tight flex items-center gap-2">
            <img src="./logo.png" alt="CoveLauncher Logo" className="w-8 h-8 object-contain" />
            CoveLauncher
          </h1>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-4 space-y-1">
          <button onClick={() => setActiveView('store')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
              activeView === 'store' ? 'text-slate-50 bg-slate-800' : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800/50'
            }`}>
            <Search className="w-5 h-5 shrink-0" /> Catalogue
          </button>

          <button onClick={() => setActiveView('library')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
              activeView === 'library' ? 'text-slate-50 bg-slate-800' : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800/50'
            }`}>
            <Folder className="w-5 h-5 shrink-0" /> Library
          </button>

          <button onClick={() => setActiveView('downloads')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
              activeView === 'downloads' ? 'text-slate-50 bg-slate-800' : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800/50'
            }`}>
            <Download className="w-5 h-5 shrink-0" /> Downloads
            {activeCount > 0 && (
              <span className="ml-auto bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {activeCount}
              </span>
            )}
          </button>

          <button onClick={() => setActiveView('firmware')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left ${
              activeView === 'firmware' ? 'text-slate-50 bg-slate-800' : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800/50'
            }`}>
            <Cpu className="w-5 h-5 shrink-0" /> Firmware
          </button>
        </nav>

        <div className="mt-auto flex flex-col border-t border-slate-800">
          <div
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`p-4 text-sm flex items-center justify-between cursor-pointer transition-colors text-slate-500 hover:text-slate-300`}
          >
            <div className="flex items-center gap-2">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </div>
          </div>
          <div
            onClick={() => setActiveView('settings')}
            className={`p-4 text-sm flex items-center gap-2 cursor-pointer transition-colors ${
              activeView === 'settings' ? 'text-slate-50 bg-slate-800/60' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Settings className="w-4 h-4" /> Settings
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-20 border-b border-slate-800 bg-slate-900/50 backdrop-blur flex items-center px-8 shrink-0">
          <form onSubmit={handleSearch} className="relative w-full max-w-2xl">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-slate-500" />
            </div>
            <input type="text"
              className="block w-full pl-10 pr-3 py-3 border border-slate-700 rounded-xl leading-5 bg-slate-800
                         text-slate-300 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500
                         focus:border-blue-500 sm:text-sm transition-all"
              placeholder="Search for games..."
              value={query}
              onChange={e => setQuery(e.target.value)} />
            <button type="submit" className="hidden">Search</button>
          </form>
        </header>

        {activeView === 'store' ? <StorePage /> : activeView === 'library' ? <LibraryPage /> : activeView === 'downloads' ? <DownloadsPage /> : activeView === 'firmware' ? <FirmwarePage downloadDir={downloadDir} setDownloads={setDownloads} /> : <SettingsPage />}
      </main>
    </div>
  );
}

export default App;

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { searchForGame, getDownloadOptions, getDirectDownloadLink, fetchImageAsBase64, getLatestGames, getPopularGames } from './scraper';
import { downloadFile, cancelDownload, pauseDownload, resumeDownload } from './downloader';
import { loadConfig, saveConfig, clearConfig, addSource, removeSource, addEmulator, removeEmulator, AppConfig, SourceConfig, EmulatorConfig } from './sources';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, process.env.VITE_DEV_SERVER_URL ? '../public/logo.png' : '../dist-web/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
    autoHideMenuBar: true,
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-web/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers
ipcMain.handle('search-game', async (_event, query: string) => {
  return await searchForGame(query);
});

ipcMain.handle('get-download-options', async (_event, url: string, gameTitle?: string) => {
  return await getDownloadOptions(url, gameTitle);
});

ipcMain.handle('get-direct-download-link', async (_event, url: string) => {
  return await getDirectDownloadLink(url);
});

ipcMain.handle('start-download', async (_event, id, url, referer, downloadDir, extract, gameTitle, coverUrl) => {
  if (mainWindow) {
    try {
      return await downloadFile(mainWindow, id, url, referer, downloadDir, extract, gameTitle, coverUrl);
    } catch (err: any) {
      if (err.message === 'Download cancelled' || err.code === 'ERR_CANCELED') {
        return null; // Cancellation is not an error
      }
      throw err;
    }
  }
});

ipcMain.handle('cancel-download', async (_event, id: string) => {
  return cancelDownload(id);
});

ipcMain.handle('pause-download', async (_event, id: string) => {
  return pauseDownload(id);
});

ipcMain.handle('resume-download', async (_event, id: string) => {
  return resumeDownload(id);
});

ipcMain.handle('get-latest-games', async () => {
  return await getLatestGames();
});

ipcMain.handle('get-popular-games', async () => {
  return await getPopularGames();
});

ipcMain.handle('get-library', async (_event, downloadDir: string) => {
  try {
    if (!fs.existsSync(downloadDir)) return [];
    
    const items = await fs.promises.readdir(downloadDir, { withFileTypes: true });
    const libraryItems = items.map((item: fs.Dirent) => {
      const isDir = item.isDirectory();
      let coverPath = undefined;
      const fullPath = path.join(downloadDir, item.name);
      
      if (isDir) {
        // If it's a directory, maybe there is a cover inside it (if extract was true)
        // Actually, our downloader saves the cover in the target directory (which is the game directory if autoExtract is true).
        const possibleCover = path.join(fullPath, `${item.name}_cover.jpg`);
        if (fs.existsSync(possibleCover)) {
          coverPath = possibleCover;
        }
      } else {
        // If it's a file, check if there's a cover with the same base name in downloadDir
        const ext = path.extname(item.name);
        const baseName = path.basename(item.name, ext);
        const possibleCover = path.join(downloadDir, `${baseName}_cover.jpg`);
        if (fs.existsSync(possibleCover)) {
          coverPath = possibleCover;
        }
      }

      const stat = fs.statSync(fullPath);

      return {
        name: item.name,
        type: isDir ? 'directory' : 'file',
        path: fullPath,
        coverPath,
        size: isDir ? 0 : stat.size,
        mtimeMs: stat.mtimeMs
      };
    });
    
    // Filter out the cover images themselves from being listed as library items
    return libraryItems.filter((item: any) => !item.name.endsWith('_cover.jpg'));
  } catch (err) {
    console.error('Error scanning library:', err);
    return [];
  }
});

ipcMain.handle('open-in-explorer', async (_event, targetPath: string) => {
  shell.showItemInFolder(targetPath);
});

ipcMain.handle('delete-library-item', async (_event, targetPath: string) => {
  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to delete item:', err);
    throw err;
  }
});

ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Download Folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('fetch-image', async (_event, url: string) => {
  return await fetchImageAsBase64(url);
});

// ─── Sources/Config Management ──────────────────────────────────────────────

ipcMain.handle('get-config', async () => {
  return loadConfig();
});

ipcMain.handle('save-config', async (_event, config: AppConfig) => {
  saveConfig(config);
  return loadConfig();
});

ipcMain.handle('clear-config', async () => {
  clearConfig();
  return loadConfig();
});

ipcMain.handle('add-source', async (_event, source: SourceConfig) => {
  return addSource(source);
});

ipcMain.handle('remove-source', async (_event, sourceId: string) => {
  return removeSource(sourceId);
});

// ─── Emulator Management ────────────────────────────────────────────────────

ipcMain.handle('add-emulator', async (_event, emulator: EmulatorConfig) => {
  return addEmulator(emulator);
});

ipcMain.handle('remove-emulator', async (_event, emulatorId: string) => {
  return removeEmulator(emulatorId);
});

ipcMain.handle('select-executable', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Emulator Executable',
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: ['exe', 'AppImage', 'app', ''] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('launch-game', async (_event, emulatorPath: string, gamePath: string, args: string) => {
  try {
    const argsArray = args ? args.split(' ').filter(a => a.trim()) : [];
    argsArray.push(gamePath);

    const child = spawn(emulatorPath, argsArray, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    return { success: true };
  } catch (err: any) {
    console.error('Error launching game:', err);
    return { success: false, error: err.message };
  }
});

// ─── Firmware / Keys (read from configured source) ──────────────────────────

ipcMain.handle('get-firmware-releases', async () => {
  const config = loadConfig();
  const source = config.sources.find(s => s.enabled && s.firmwareUrl);
  if (!source) return [];

  const axios = await import('axios');
  const response = await axios.default.get(source.firmwareUrl!, {
    headers: { 'Accept': 'application/vnd.github.v3+json' }
  });
  return response.data.map((release: any) => {
    const zipAsset = release.assets.find((a: any) => a.name.endsWith('.zip'));
    return {
      version: release.tag_name,
      name: release.name || release.tag_name,
      downloadUrl: zipAsset?.browser_download_url || null,
      size: zipAsset?.size || 0,
      publishedAt: release.published_at
    };
  }).filter((r: any) => r.downloadUrl);
});

ipcMain.handle('get-prod-keys', async () => {
  const config = loadConfig();
  const source = config.sources.find(s => s.enabled && s.keysUrl);
  if (!source) return { version: '', downloadUrl: '', referer: '' };

  const axios = await import('axios');
  const cheerio = await import('cheerio');
  const https = await import('https');
  const response = await axios.default.get(source.keysUrl!, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  });
  const $ = cheerio.load(response.data);

  const pageText = $('h1.entry-title, article h1, h1, h2, .entry-content').first().text();
  const versionMatch = pageText.match(/v?(\d+\.\d+[\.\d]*)/);
  const version = versionMatch ? `v${versionMatch[1]}` : 'Latest';

  let downloadUrl = '';
  $('a[href]').each((_: any, el: any) => {
    if (downloadUrl) return;
    const href = $(el).attr('href') || '';
    if (!href || href.startsWith('#') || href.includes('javascript:')) return;
    const isKeysFile = /\.(keys|zip)(\?|$)/i.test(href);
    const isDownloadPath = /\/(download|dl)\b/i.test(href) || /[?&]dl=/i.test(href);
    if (isKeysFile || isDownloadPath) downloadUrl = href;
  });

  return { version, downloadUrl, referer: source.keysUrl };
});

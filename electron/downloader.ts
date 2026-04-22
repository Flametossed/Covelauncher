import fs from 'fs';
import path from 'path';
import axios from 'axios';
import extractZip from 'extract-zip';
import type { BrowserWindow } from 'electron';

export interface DownloadProgress {
  id: string;
  loaded: number;
  total: number;
  percentage: number;
  status: 'downloading' | 'paused' | 'extracting' | 'completed' | 'error' | 'cancelled';
  error?: string;
  fileName: string;
}

interface ActiveDownload {
  controller: AbortController;
  filePath: string;
  stream: NodeJS.ReadableStream | null;
  writer: fs.WriteStream | null;
  paused: boolean;
  chunks: Buffer[];
}

// Registry of active downloads keyed by download ID
const activeDownloads = new Map<string, ActiveDownload>();

export function cancelDownload(id: string): boolean {
  const dl = activeDownloads.get(id);
  if (!dl) return false;
  dl.controller.abort();
  // Close and remove the partial file
  try {
    dl.writer?.destroy();
    if (fs.existsSync(dl.filePath)) {
      fs.unlinkSync(dl.filePath);
    }
  } catch (_) {}
  activeDownloads.delete(id);
  return true;
}

export function pauseDownload(id: string): boolean {
  const dl = activeDownloads.get(id);
  if (!dl || dl.paused) return false;
  dl.paused = true;
  // Pause the readable stream so no more data events fire
  if (dl.stream) {
    (dl.stream as any).pause?.();
  }
  return true;
}

export function resumeDownload(id: string): boolean {
  const dl = activeDownloads.get(id);
  if (!dl || !dl.paused) return false;
  dl.paused = false;
  if (dl.stream) {
    (dl.stream as any).resume?.();
  }
  return true;
}

export async function downloadFile(
  window: BrowserWindow,
  id: string,
  url: string,
  referer: string,
  downloadDir: string,
  extract: boolean,
  gameTitle?: string,
  coverUrl?: string
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      // Download cover art if provided
      if (gameTitle && coverUrl) {
        try {
          const safeTitle = gameTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
          const coverPath = path.join(downloadDir, `${safeTitle}_cover.jpg`);
          if (!fs.existsSync(coverPath)) {
            const imgResp = await axios.get(coverUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(coverPath, imgResp.data);
          }
        } catch (err) {
          console.error('Failed to download cover art:', err);
        }
      }

      const controller = new AbortController();

      const isGitHub = url.includes('githubusercontent.com') || url.includes('github.com');
      const response = await axios.get(url, {
        responseType: 'stream',
        maxRedirects: 10,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': isGitHub ? 'https://github.com/' : referer,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal
      });

      // Try to get filename from content-disposition
      let fileName = 'downloaded_file';
      const contentDisposition = response.headers['content-disposition'];
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+?)"?$/);
        if (match && match[1]) {
          fileName = match[1];
        }
      } else {
        // Fallback to URL path
        const urlObj = new URL(url);
        fileName = path.basename(urlObj.pathname) || fileName;
      }

      const totalSize = parseInt(String(response.headers['content-length'] || '0'), 10);
      const filePath = path.join(downloadDir, fileName);
      const writer = fs.createWriteStream(filePath);

      const downloadEntry: ActiveDownload = {
        controller,
        filePath,
        stream: response.data,
        writer,
        paused: false,
        chunks: []
      };
      activeDownloads.set(id, downloadEntry);

      let loaded = 0;
      let lastUpdate = 0;

      response.data.on('data', (chunk: Buffer) => {
        loaded += chunk.length;
        const now = Date.now();
        // Update progress every 500ms
        if (now - lastUpdate > 500 || loaded === totalSize) {
          lastUpdate = now;
          const percentage = totalSize ? Math.round((loaded / totalSize) * 100) : 0;

          const entry = activeDownloads.get(id);
          if (entry?.paused) return; // Don't send updates while paused

          window.webContents.send('download-progress', {
            id,
            loaded,
            total: totalSize,
            percentage,
            status: 'downloading',
            fileName
          } as DownloadProgress);
        }
      });

      response.data.pipe(writer);

      writer.on('finish', async () => {
        activeDownloads.delete(id);

        if (extract && (fileName.endsWith('.zip') || fileName.endsWith('.rar'))) {
          window.webContents.send('download-progress', {
            id,
            loaded: totalSize,
            total: totalSize,
            percentage: 100,
            status: 'extracting',
            fileName
          } as DownloadProgress);

          try {
            if (fileName.endsWith('.zip')) {
              const gameFolderName = fileName.replace(/\.zip$/i, '');
              const extractPath = path.join(downloadDir, gameFolderName);
              if (!fs.existsSync(extractPath)) {
                fs.mkdirSync(extractPath, { recursive: true });
              }
              await extractZip(filePath, { dir: extractPath });
              fs.unlinkSync(filePath); // Remove archive after extraction
            } else if (fileName.endsWith('.rar')) {
               // We don't have unrar installed natively easily in node,
               // for now just skip or leave it downloaded.
            }

            window.webContents.send('download-progress', {
              id,
              loaded: totalSize,
              total: totalSize,
              percentage: 100,
              status: 'completed',
              fileName
            } as DownloadProgress);
            resolve(filePath);
          } catch (err: any) {
            window.webContents.send('download-progress', {
              id,
              loaded: totalSize,
              total: totalSize,
              percentage: 100,
              status: 'error',
              error: 'Extraction failed: ' + err.message,
              fileName
            } as DownloadProgress);
            reject(err);
          }
        } else {
          window.webContents.send('download-progress', {
            id,
            loaded: totalSize,
            total: totalSize,
            percentage: 100,
            status: 'completed',
            fileName
          } as DownloadProgress);
          resolve(filePath);
        }
      });

      writer.on('error', (err) => {
        activeDownloads.delete(id);
        window.webContents.send('download-progress', {
          id,
          loaded,
          total: totalSize,
          percentage: 0,
          status: 'error',
          error: 'Write failed: ' + err.message,
          fileName
        } as DownloadProgress);
        reject(err);
      });

      // Handle abort (cancel)
      controller.signal.addEventListener('abort', () => {
        writer.destroy();
        const pct = totalSize ? Math.round((loaded / totalSize) * 100) : 0;
        window.webContents.send('download-progress', {
          id,
          loaded,
          total: totalSize,
          percentage: pct,
          status: 'cancelled',
          fileName
        } as DownloadProgress);
        reject(new Error('Download cancelled'));
      });

    } catch (error: any) {
      if (error.message === 'Download cancelled' || error.code === 'ERR_CANCELED') {
        return; // Already handled by abort listener
      }
      activeDownloads.delete(id);
      window.webContents.send('download-progress', {
        id,
        loaded: 0,
        total: 0,
        percentage: 0,
        status: 'error',
        error: 'Download failed: ' + error.message,
        fileName: 'unknown'
      } as DownloadProgress);
      reject(error);
    }
  });
}

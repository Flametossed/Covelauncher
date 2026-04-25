import axios from 'axios';

export interface MediaFireFile {
  filename: string;
  quickkey: string;
  size: string;
  gameTitle: string;
}

const folderCache = new Map<string, MediaFireFile[]>();

export function parseGameTitleFromFilename(filename: string): string {
  const match = filename.match(/^([^\[]+)/);
  return match ? match[1].trim() : filename.replace(/\.zip$/i, '').trim();
}

export function detectSaveFormat(filename: string): string {
  const f = filename.toLowerCase();
  if (f.includes('languagepack') || f.includes('language pack')) return 'LANGPACK';
  if (f.includes('bcat')) return 'BCAT';
  if (/\[mod\]|\bmod\b/.test(f)) return 'MOD';
  return 'SAVE';
}

export function formatMediaFireSize(size: string): string {
  const n = parseInt(size, 10);
  if (!n || isNaN(n)) return 'Unknown';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${parseFloat((n / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export async function getMediaFireFolderFiles(folderKey: string): Promise<MediaFireFile[]> {
  if (folderCache.has(folderKey)) return folderCache.get(folderKey)!;

  const files: MediaFireFile[] = [];
  let chunk = 1;
  let moreChunks = true;

  while (moreChunks) {
    try {
      const url = `https://www.mediafire.com/api/1.5/folder/get_content.php?folder_key=${folderKey}&content_type=files&response_format=json&chunk=${chunk}&chunk_size=100`;
      const resp = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 15000
      });
      const content = resp.data?.response?.folder_content;
      if (!content) break;

      for (const file of (content.files || [])) {
        files.push({
          filename: file.filename,
          quickkey: file.quickkey,
          size: file.size || '0',
          gameTitle: parseGameTitleFromFilename(file.filename)
        });
      }

      moreChunks = content.more_chunks === 'yes';
      chunk++;
    } catch (err) {
      console.error(`Error fetching MediaFire folder chunk ${chunk}:`, err);
      break;
    }
  }

  folderCache.set(folderKey, files);
  return files;
}

export function getUniqueGameTitles(files: MediaFireFile[]): MediaFireFile[] {
  const seen = new Set<string>();
  const unique: MediaFireFile[] = [];
  for (const f of files) {
    const key = normalizeTitle(f.gameTitle);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(f);
    }
  }
  return unique;
}

export async function searchMediaFireFiles(folderKey: string, query: string): Promise<MediaFireFile[]> {
  const files = await getMediaFireFolderFiles(folderKey);
  const q = normalizeTitle(query);
  return files.filter(f => {
    const t = normalizeTitle(f.gameTitle);
    return t.includes(q) || q.includes(t);
  });
}

export async function getFilesForGame(folderKey: string, gameTitle: string): Promise<MediaFireFile[]> {
  const files = await getMediaFireFolderFiles(folderKey);
  const q = normalizeTitle(gameTitle);
  return files.filter(f => {
    const t = normalizeTitle(f.gameTitle);
    return t.startsWith(q) || q.startsWith(t) || t === q;
  });
}

export async function getMediaFireDirectLink(quickkey: string): Promise<string> {
  // Try the MediaFire links API first
  try {
    const apiUrl = `https://www.mediafire.com/api/1.5/file/get_links.php?quick_key=${quickkey}&response_format=json`;
    const resp = await axios.get(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 10000
    });
    const link = resp.data?.response?.links?.[0]?.direct_download;
    if (link) return link;
  } catch (err) {
    console.error('MediaFire get_links API error:', err);
  }

  // Fallback: scrape the file page
  const cheerio = await import('cheerio');
  const pageUrl = `https://www.mediafire.com/file/${quickkey}/file`;
  const resp = await axios.get(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    maxRedirects: 10,
    timeout: 15000
  });
  const $ = cheerio.load(resp.data);
  const link = $('a#downloadButton').attr('href')
    || $('a.popsok').attr('href')
    || $('a[aria-label="Download file"]').attr('href');

  if (!link) throw new Error(`Could not find MediaFire download link for key: ${quickkey}`);
  return link;
}

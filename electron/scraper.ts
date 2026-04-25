import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import { getEnabledSources, SourceConfig } from './sources';
import { searchMods, getModDownloadOptions } from './github-mods';
import {
  getMediaFireFolderFiles, getUniqueGameTitles, searchMediaFireFiles,
  getFilesForGame, detectSaveFormat, formatMediaFireSize, getMediaFireDirectLink
} from './mediafire';

export interface GameResult {
  title: string;
  url: string;
  imageUrl?: string;
  sourceId?: string;
}

export interface DownloadOption {
  name: string;
  url: string;
  size: string;
  format: string;
  sourceId?: string;
}

export interface GamePageData {
  options: DownloadOption[];
  coverUrl?: string;
}

// ─── Shared per-item scraper ─────────────────────────────────────────────────
async function scrapeGameList(url: string, source: SourceConfig, limit = 16): Promise<GameResult[]> {
  try {
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    const results: GameResult[] = [];

    const { selectors } = source;
    
    $(selectors.gameList).each((_, el) => {
      if (results.length >= limit) return false as any;
      const title = $(el).find(selectors.gameTitle).text().trim();
      
      let link = '';
      if (selectors.gameLink === '') {
         link = $(el).attr('href') || '';
      } else {
         link = $(el).find(selectors.gameLink).attr('href') || '';
      }
      if (link && link.startsWith('/')) link = source.baseUrl + link;

      let imageUrl: string | undefined;
      const imgEl = $(el).find(selectors.gameImage).first();
      imageUrl = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-original');
      if (imageUrl && imageUrl.startsWith('/')) imageUrl = source.baseUrl + imageUrl;
      
      if (title && link) results.push({ title, url: link, imageUrl: imageUrl || undefined, sourceId: source.id });
    });

    return Array.from(new Map(results.map(r => [r.url, r])).values());
  } catch (err) {
    console.error(`Error scraping game list for source ${source.name} at ${url}:`, err);
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function getMediaFireGameList(source: SourceConfig, limit: number): Promise<GameResult[]> {
  const files = await getMediaFireFolderFiles(source.folderKey!);
  return getUniqueGameTitles(files).slice(0, limit).map(f => ({
    title: f.gameTitle,
    url: `${source.baseUrl}?title=${encodeURIComponent(f.gameTitle)}`,
    imageUrl: undefined,
    sourceId: source.id
  }));
}

export async function getLatestGames(): Promise<GameResult[]> {
  const sources = getEnabledSources().filter(s => s.showInCatalog !== false);
  const allResults = await Promise.all(sources.map(source => {
    if (source.type === 'mediafire-folder' && source.folderKey) {
      return getMediaFireGameList(source, 16);
    }
    return scrapeGameList(`${source.baseUrl}${source.paths.latest}`, source, 16);
  }));
  return allResults.flat();
}

export async function getPopularGames(): Promise<GameResult[]> {
  const sources = getEnabledSources().filter(s => s.showInCatalog !== false);
  const allResults = await Promise.all(sources.map(source => {
    if (source.type === 'mediafire-folder' && source.folderKey) {
      return getMediaFireGameList(source, 16);
    }
    return scrapeGameList(`${source.baseUrl}${source.paths.popular}`, source, 16);
  }));
  return allResults.flat();
}

export async function searchForGame(query: string): Promise<GameResult[]> {
  const sources = getEnabledSources().filter(s => s.showInCatalog !== false);
  const allResults = await Promise.all(sources.map(async source => {
    if (source.type === 'mediafire-folder' && source.folderKey) {
      try {
        const matchingFiles = await searchMediaFireFiles(source.folderKey, query);
        return getUniqueGameTitles(matchingFiles).map(f => ({
          title: f.gameTitle,
          url: `${source.baseUrl}?title=${encodeURIComponent(f.gameTitle)}`,
          imageUrl: undefined,
          sourceId: source.id
        }));
      } catch (err) {
        console.error(`Error searching MediaFire source ${source.name}:`, err);
        return [];
      }
    }
    try {
      const searchUrl = `${source.baseUrl}${source.paths.search}${encodeURIComponent(query)}`;
      const response = await axios.get(searchUrl);
      const $ = cheerio.load(response.data);
      const results: GameResult[] = [];
      const { selectors } = source;

      $(selectors.gameList).each((_, el) => {
        const title = $(el).find(selectors.gameTitle).text().trim();
        let link = $(el).find(selectors.gameLink).attr('href') || '';
        if (link && link.startsWith('/')) link = source.baseUrl + link;

        const imgEl = $(el).find(selectors.gameImage).first();
        let imageUrl = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-original');
        if (imageUrl && imageUrl.startsWith('/')) imageUrl = source.baseUrl + imageUrl;
        if (title && link) results.push({ title, url: link, imageUrl: imageUrl || undefined, sourceId: source.id });
      });

      // Fallback: parallel-array approach (no images)
      if (results.length === 0) {
        const titles: string[] = [];
        $(selectors.gameTitle).each((_, el) => { titles.push($(el).text().trim()); });
        const links: string[] = [];
        $(selectors.gameLink).each((_, el) => { links.push($(el).attr('href') || ''); });
        for (let i = 0; i < Math.min(titles.length, links.length); i++) {
          let link = links[i];
          if (link && link.startsWith('/')) link = source.baseUrl + link;
          if (titles[i] && link) results.push({ title: titles[i], url: link, sourceId: source.id });
        }
      }

      return Array.from(new Map(results.map(item => [item.url, item])).values());
    } catch (error) {
      console.error(`Error searching for game in source ${source.name}:`, error);
      return [];
    }
  }));
  return allResults.flat();
}

export async function getDownloadOptions(gameUrl: string, gameTitle?: string): Promise<GamePageData> {
  const sources = getEnabledSources();
  let source = sources.find(s => gameUrl.startsWith(s.baseUrl));
  if (!source) {
    if (sources.length === 1) source = sources[0];
    else throw new Error('Could not find matching source for URL: ' + gameUrl);
  }

  // Handle MediaFire folder sources directly via API
  if (source.type === 'mediafire-folder' && source.folderKey) {
    try {
      const titleParam = (() => {
        try { return new URL(gameUrl).searchParams.get('title') || gameTitle || ''; }
        catch { return gameTitle || ''; }
      })();
      const files = await getFilesForGame(source.folderKey, titleParam);
      const options: DownloadOption[] = files.map(f => ({
        name: f.filename.replace(/\.zip$/i, ''),
        url: `https://www.mediafire.com/file/${f.quickkey}/file`,
        size: formatMediaFireSize(f.size),
        format: detectSaveFormat(f.filename),
        sourceId: source!.id
      }));
      return { options, coverUrl: undefined };
    } catch (error) {
      console.error('Error getting MediaFire download options:', error);
      throw new Error('Failed to get MediaFire download options');
    }
  }

  try {
    const gameRes = await axios.get(gameUrl);
    const $game = cheerio.load(gameRes.data);
    const { selectors } = source;
    
    let nextUrl = $game(selectors.downloadButton).attr('href');
    if (!nextUrl) throw new Error('Could not find the intermediate download page link');
    if (nextUrl.startsWith('/')) nextUrl = source.baseUrl + nextUrl;

    // Extract cover art
    let coverUrl: string | undefined;
    for (const sel of selectors.coverImage) {
      if (sel.includes('meta')) {
         coverUrl = $game(sel).attr('content');
      } else {
         const src = $game(sel).first().attr('src') || $game(sel).first().attr('data-src');
         if (src) coverUrl = src;
      }
      if (coverUrl) break;
    }
    if (coverUrl && coverUrl.startsWith('/')) coverUrl = source.baseUrl + coverUrl;

    const nextRes = await axios.get(nextUrl);
    const $next = cheerio.load(nextRes.data);

    const options: DownloadOption[] = [];
    $next(selectors.downloadTable).each((_, table) => {
      $next(table).find(selectors.downloadRow).each((_, tr) => {
        const nameEl = $next(tr).find(selectors.downloadName);
        const name   = nameEl.text().trim();
        let url      = nameEl.attr('href');
        if (selectors.downloadUrl && selectors.downloadUrl !== selectors.downloadName) {
           url = $next(tr).find(selectors.downloadUrl).attr('href');
        }
        if (url && url.startsWith('/')) url = source.baseUrl + url;

        const size   = $next(tr).find(selectors.downloadSize).text().trim();
        const format = $next(tr).find(selectors.downloadFormat).text().trim().toUpperCase();
        if (name && url) options.push({ name, url, size, format, sourceId: source!.id });
      });
    });

    const filtered = options.filter(opt => {
      const nameLower = opt.name.toLowerCase();
      const isPdf = opt.format.includes('PDF') || nameLower.endsWith('.pdf');
      const isEpub = opt.format.includes('EPUB') || nameLower.endsWith('.epub');
      const isMod = opt.format.toUpperCase().includes('MOD') || /\bmod\b/i.test(opt.name);
      const isArchive = opt.format === 'RAR' || opt.format === 'ZIP' || nameLower.endsWith('.rar') || nameLower.endsWith('.zip');
      return !isPdf && !isEpub && !isMod && !isArchive;
    });

    // Deduplicate options by name, size, and format to avoid redundant "Full version" entries
    const uniqueOptions: DownloadOption[] = [];
    const seen = new Set<string>();
    for (const opt of filtered) {
      const key = `${opt.name}|${opt.size}|${opt.format}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueOptions.push(opt);
      }
    }

    // Append matching GitHub mods
    if (gameTitle) {
      try {
        const modResults = await searchMods(gameTitle);
        for (const mod of modResults) {
          const modData = await getModDownloadOptions(mod.url.slice('github-mod://'.length));
          uniqueOptions.push(...modData.options);
        }
      } catch (err) {
        console.error('Failed to fetch GitHub mods for game:', err);
      }
    }

    // Append matching saves/mods from MediaFire folder sources
    if (gameTitle) {
      const mfSources = sources.filter(s => s.type === 'mediafire-folder' && s.folderKey && s.enabled);
      for (const mfSource of mfSources) {
        try {
          const mfFiles = await getFilesForGame(mfSource.folderKey!, gameTitle);
          for (const file of mfFiles) {
            uniqueOptions.push({
              name: file.filename.replace(/\.zip$/i, ''),
              url: `https://www.mediafire.com/file/${file.quickkey}/file`,
              size: formatMediaFireSize(file.size),
              format: detectSaveFormat(file.filename),
              sourceId: mfSource.id
            });
          }
        } catch (err) {
          console.error('Failed to fetch MediaFire saves for game:', err);
        }
      }
    }

    return { options: uniqueOptions, coverUrl };
  } catch (error) {
    console.error('Error getting download options:', error);
    throw new Error('Failed to get download options');
  }
}

export async function getDirectDownloadLink(optionUrl: string): Promise<string> {
  // GitHub raw URLs are direct — no redirect page needed
  if (optionUrl.startsWith('https://raw.githubusercontent.com/') ||
      optionUrl.startsWith('https://github.com/Fl4sh9174/')) {
    return optionUrl;
  }

  // MediaFire file URLs — resolve via API then page scrape fallback
  if (/mediafire\.com\/file\/[a-z0-9]+/i.test(optionUrl)) {
    const quickkey = optionUrl.replace(/.*mediafire\.com\/file\//i, '').split('/')[0];
    return getMediaFireDirectLink(quickkey);
  }

  const sources = getEnabledSources();
  let source = sources.find(s => optionUrl.startsWith(s.baseUrl));
  if (!source && sources.length === 1) source = sources[0];

  try {
    const res = await axios.get(optionUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': source?.baseUrl ?? optionUrl,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    const $ = cheerio.load(res.data);
    let downloadLink: string | undefined;
    
    if (source && source.selectors.directDownloadLink) {
        downloadLink = $(source.selectors.directDownloadLink).attr('href');
    } else {
        downloadLink = $('a#download-link').attr('href');
    }

    if (!downloadLink) throw new Error('Direct download link not found on the final page');
    if (source && downloadLink.startsWith('/')) downloadLink = source.baseUrl + downloadLink;
    return downloadLink;
  } catch (error) {
    console.error('Error getting direct link:', error);
    throw new Error('Failed to extract direct download link');
  }
}

export async function fetchImageAsBase64(url: string): Promise<string> {
  try {
    if (url.startsWith('file://')) {
      const filePath = url.replace('file://', '');
      const data = await fs.promises.readFile(filePath);
      const ext = filePath.split('.').pop()?.toLowerCase();
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const base64 = data.toString('base64');
      return `data:${contentType};base64,${base64}`;
    }

    const sources = getEnabledSources();
    const matchedSource = sources.find(s => url.startsWith(s.baseUrl));
    const referer = matchedSource ? `${matchedSource.baseUrl}/` : url;

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: { Referer: referer }
    });
    const contentType = String(response.headers['content-type'] || 'image/jpeg');
    const base64 = Buffer.from(response.data).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error('Error fetching image:', error);
    throw new Error('Failed to fetch image');
  }
}

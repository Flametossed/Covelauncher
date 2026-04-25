import axios from 'axios';

export interface MediaFireFile {
  filename: string;
  quickkey: string;
  size: string;
  gameTitle: string;
}

const folderCache = new Map<string, MediaFireFile[]>();

const KNOWN_TYPE_TAG = /^\s*\[\s*(bcat|save|saves|mod|mods|dlc|upd|update|updates|patch|patches|langpack|languagepack|language\s*pack|sins|nx|switch|us|eu|jp|jpn|usa|europe|v\d[\w.]*)[^\]]*\]\s*/i;

export function parseGameTitleFromFilename(filename: string): string {
  let s = filename.replace(/\.(zip|7z|rar|tar\.gz|tar|gz)$/i, '').trim();
  // Strip ONLY leading brackets whose content looks like a type tag (BCAT, SAVE, region, version).
  // Leave other leading brackets intact — they may contain the game name.
  let prev: string;
  do { prev = s; s = s.replace(KNOWN_TYPE_TAG, '').trim(); } while (s !== prev);
  // If string still starts with a bracket, the bracket likely contains the game name itself.
  if (s.startsWith('[')) {
    const m = s.match(/^\[([^\]]+)\]/);
    if (m) return m[1].trim();
  }
  const match = s.match(/^([^\[]+)/);
  return (match ? match[1] : s).trim();
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
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Common Switch / gaming abbreviations. Single-string entries are treated as
// one phrase (all words required). Array entries are alternatives (any one is
// enough) — useful for two-version games like Pokemon SV (Scarlet OR Violet).
const ABBREVIATIONS: Record<string, string | string[]> = {
  botw: 'breath of the wild',
  totk: 'tears of the kingdom',
  ss: 'skyward sword',
  oot: 'ocarina of time',
  mm: 'majoras mask',
  ww: 'wind waker',
  tp: 'twilight princess',
  mk8: 'mario kart 8',
  mkd: 'mario kart 8 deluxe',
  ssbu: 'super smash bros ultimate',
  ssb: 'super smash bros',
  acnh: 'animal crossing new horizons',
  smo: 'super mario odyssey',
  pla: 'pokemon legends arceus',
  loz: 'legend of zelda',
  smtv: 'shin megami tensei 5',
  smt: 'shin megami tensei',
  bayo: 'bayonetta',
  ff: 'final fantasy',
  dq: 'dragon quest',
  p5r: 'persona 5 royal',
  p5: 'persona 5',
  xc: 'xenoblade chronicles',
  xc2: 'xenoblade chronicles 2',
  xc3: 'xenoblade chronicles 3',
  re: 'resident evil',
  // OR-alternatives: file represents any one of these versions
  swsh: ['sword', 'shield'],
  sv: ['scarlet', 'violet'],
  bdsp: ['brilliant diamond', 'shining pearl'],
  lgpe: ['lets go pikachu', 'lets go eevee'],
};

// Expand all abbreviations in text into the cartesian product of variants.
// Single-string entries inline their words; array entries fork into branches.
export function expandToVariants(text: string): string[] {
  let variants: string[][] = [[]];
  for (const tok of text.split(' ')) {
    const exp = ABBREVIATIONS[tok];
    if (exp === undefined) {
      variants = variants.map(v => [...v, tok]);
    } else {
      const alts = Array.isArray(exp) ? exp : [exp];
      const next: string[][] = [];
      for (const v of variants) {
        for (const alt of alts) next.push([...v, ...alt.split(' ')]);
      }
      variants = next;
    }
  }
  return variants.map(v => v.join(' '));
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
  if (q.length < 3) return [];
  // Combine words from every q-variant into one allow-set: a file token only
  // needs to appear in *some* spelling of the game title.
  const qWords = new Set<string>();
  for (const v of expandToVariants(q)) for (const w of v.split(' ')) qWords.add(w);
  return files.filter(f => {
    const t = normalizeTitle(f.gameTitle);
    if (t.length < 3) return false;
    if (t === q) return true;
    if (t.startsWith(q) || q.startsWith(t)) return true;
    // Token-subset across t-variants: file matches if any expansion has all its
    // (>=3 char) words present in the game title's allowed word set.
    for (const variant of expandToVariants(t)) {
      const tWords = variant.split(' ').filter(w => w.length >= 3);
      if (tWords.length > 0 && tWords.every(w => qWords.has(w))) return true;
    }
    return false;
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

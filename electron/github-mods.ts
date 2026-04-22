import axios from 'axios';

const GITHUB_API = 'https://api.github.com/repos/Fl4sh9174/Switch-Ultrawide-Mods/contents/';

interface ModEntry {
  title: string;
  filename: string;
  downloadUrl: string;
  size: number;
}

let modCache: ModEntry[] | null = null;

function parseModTitle(filename: string): string {
  // "Game Title [0100000000000000][USA][mods].zip" → "Game Title"
  const match = filename.match(/^(.+?)\s*\[[\dA-Fa-f]{16}\]/i);
  return match ? match[1].trim() : filename.replace(/\.zip$/i, '').trim();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

async function getModList(): Promise<ModEntry[]> {
  if (modCache) return modCache;
  const res = await axios.get(GITHUB_API, {
    headers: { Accept: 'application/vnd.github.v3+json' },
    timeout: 10000
  });
  modCache = (res.data as any[])
    .filter((f: any) => f.type === 'file' && f.name.toLowerCase().endsWith('.zip'))
    .map((f: any) => ({
      title: parseModTitle(f.name),
      filename: f.name,
      downloadUrl: f.download_url as string,
      size: f.size as number
    }));
  return modCache;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function searchMods(query: string): Promise<{ title: string; url: string; sourceId: string }[]> {
  try {
    const mods = await getModList();
    const q = normalize(query);
    return mods
      .filter(m => {
        const t = normalize(m.title);
        return t.includes(q) || q.includes(t);
      })
      .map(m => ({
        title: `${m.title} [Ultrawide/FPS Mod]`,
        url: `github-mod://${encodeURIComponent(m.filename)}`,
        sourceId: 'github-mods'
      }));
  } catch (err) {
    console.error('GitHub mods search failed:', err);
    return [];
  }
}

export async function getModDownloadOptions(encodedFilename: string): Promise<{ options: any[]; coverUrl?: string }> {
  const filename = decodeURIComponent(encodedFilename);
  const mods = await getModList();
  const mod = mods.find(m => m.filename === filename);
  if (!mod) throw new Error('Mod not found: ' + filename);
  return {
    options: [{
      name: `${mod.title} [Ultrawide/FPS Mod]`,
      url: mod.downloadUrl,
      size: formatBytes(mod.size),
      format: 'MOD',
      sourceId: 'github-mods'
    }]
  };
}

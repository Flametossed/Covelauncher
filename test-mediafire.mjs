// Standalone test of mediafire parsing/matching logic.
// Mirrors electron/mediafire.ts — keep in sync.

const KNOWN_TYPE_TAG = /^\s*\[\s*(bcat|save|saves|mod|mods|dlc|upd|update|updates|patch|patches|langpack|languagepack|language\s*pack|sins|nx|switch|us|eu|jp|jpn|usa|europe|v\d[\w.]*)[^\]]*\]\s*/i;

function parseGameTitleFromFilename(filename) {
  let s = filename.replace(/\.(zip|7z|rar|tar\.gz|tar|gz)$/i, '').trim();
  let prev;
  do { prev = s; s = s.replace(KNOWN_TYPE_TAG, '').trim(); } while (s !== prev);
  if (s.startsWith('[')) {
    const m = s.match(/^\[([^\]]+)\]/);
    if (m) return m[1].trim();
  }
  const match = s.match(/^([^\[]+)/);
  return (match ? match[1] : s).trim();
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const ABBREVIATIONS = {
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
  swsh: ['sword', 'shield'],
  sv: ['scarlet', 'violet'],
  bdsp: ['brilliant diamond', 'shining pearl'],
  lgpe: ['lets go pikachu', 'lets go eevee'],
};

function expandToVariants(text) {
  let variants = [[]];
  for (const tok of text.split(' ')) {
    const exp = ABBREVIATIONS[tok];
    if (exp === undefined) {
      variants = variants.map(v => [...v, tok]);
    } else {
      const alts = Array.isArray(exp) ? exp : [exp];
      const next = [];
      for (const v of variants) {
        for (const alt of alts) next.push([...v, ...alt.split(' ')]);
      }
      variants = next;
    }
  }
  return variants.map(v => v.join(' '));
}

function detectSaveFormat(filename) {
  const f = filename.toLowerCase();
  if (f.includes('languagepack') || f.includes('language pack')) return 'LANGPACK';
  if (f.includes('bcat')) return 'BCAT';
  if (/\[mod\]|\bmod\b/.test(f)) return 'MOD';
  return 'SAVE';
}

function getFilesForGame(files, gameTitle) {
  const q = normalizeTitle(gameTitle);
  if (q.length < 3) return [];
  const qWords = new Set();
  for (const v of expandToVariants(q)) for (const w of v.split(' ')) qWords.add(w);
  return files.filter(f => {
    const t = normalizeTitle(parseGameTitleFromFilename(f));
    if (t.length < 3) return false;
    if (t === q) return true;
    if (t.startsWith(q) || q.startsWith(t)) return true;
    for (const variant of expandToVariants(t)) {
      const tWords = variant.split(' ').filter(w => w.length >= 3);
      if (tWords.length > 0 && tWords.every(w => qWords.has(w))) return true;
    }
    return false;
  });
}

// ─── Test cases ──────────────────────────────────────────────────────────────

const filenames = [
  'Pokemon Sword [SAVE].zip',
  'Pokemon Sword [BCAT].zip',
  'Pokemon Shield [SAVE].zip',
  '[BCAT] Pokemon Sword.zip',
  '[Pokemon Sword] BCAT.zip',
  '[Sins] [BCAT] Mario Kart 8 Deluxe.zip',
  'Mario Kart 8 Deluxe [BCAT] [v1.0] [US].zip',
  'Pokemon-Sword-BCAT.zip',
  'Pokemon_Sword_BCAT.zip',
  '[Animal Crossing - New Horizons] BCAT.zip',
  'Animal Crossing - New Horizons - BCAT_v2.0.4 - 02-01-2024.zip',
  '[BCAT].zip',
  'BCAT.zip',
  'languagepack-pokemon.zip',
  '[LanguagePack] Zelda BOTW.zip',
  'random-file.zip',
  'Mario Odyssey [SAVE].zip',
  'Sword Save Generic [SAVE].zip',
  'Super Smash Bros [BCAT].zip',
  'Zelda TOTK [BCAT].zip',
  'Pokemon SV [SAVE].zip',
  'ACNH [BCAT].zip',
];

console.log('─── parseGameTitleFromFilename ───');
for (const f of filenames) {
  const parsed = parseGameTitleFromFilename(f);
  const norm = normalizeTitle(parsed);
  const fmt = detectSaveFormat(f);
  console.log(`  ${f.padEnd(60)} → "${parsed}" [${norm}] (${fmt})`);
}

console.log('\n─── normalizeTitle edge cases ───');
const normCases = ['Pokemon-Sword-BCAT', 'Pokemon_Sword', 'The Legend of Zelda: BOTW', '---', '[]', 'A1B2C3'];
for (const s of normCases) console.log(`  "${s}" → "${normalizeTitle(s)}"`);

console.log('\n─── getFilesForGame matching ───');
const games = [
  'Pokemon Sword',
  'Mario Kart 8 Deluxe',
  'Animal Crossing: New Horizons',
  'The Legend of Zelda: Breath of the Wild',
  'Zelda BOTW',
  'Super Mario Odyssey',
  'Super Smash Bros. Ultimate',
  'The Legend of Zelda: Tears of the Kingdom',
  'Pokemon Scarlet',
  'Pokemon Violet',
  'Animal Crossing: New Horizons',
  'A',  // too short
];
for (const g of games) {
  const matches = getFilesForGame(filenames, g);
  console.log(`\n  Game: "${g}"`);
  if (matches.length === 0) console.log('    (no matches)');
  for (const m of matches) console.log(`    ✓ ${m}`);
}

console.log('\n─── Regression: empty-title file should NOT match every game ───');
const trickyFiles = ['---.zip', '[].zip', '[BCAT].zip', '[SAVE].zip'];
for (const f of trickyFiles) {
  const matches = getFilesForGame([f], 'Pokemon Sword');
  console.log(`  ${f.padEnd(20)} matches "Pokemon Sword"? ${matches.length > 0 ? '✗ FAIL' : '✓ pass'}`);
}

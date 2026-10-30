// Cuts the full arcade lists (data/arcade/*.json) into the pieces the app reads
// (src/arcade-catalog.js): /assets/arcade/index.json and per core
//   s<n>.json  sets by name,
//   c<n>.json  ROM checksum → the sets with that file and their file counts (enough to find the
//              set a renamed zip fits best without reading any set).
// Run by the build (vite.config.js); deterministic.
//
//   node scripts/arcade-shards.mjs <output folder>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setBucket, crcBucket } from '../src/arcade-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(root, 'data', 'arcade');
export const ARCADE_LISTS = Object.freeze({
  fbneo: 'arcade-fbneo.json',
  fbalpha2012_cps2: 'arcade-fba2012-cps2.json',
  mame2003_plus_next: 'arcade-mame2003plus-next.json',
  mame2003_plus: 'arcade-mame2003plus.json'
});
const ROM_OF = 4, FLAGS = 5, ROMS = 6;
// Small pieces: a renamed zip's candidates (a game's clones) are spread over many of them.
const SET_PIECE = 12 * 1024, CRC_PIECE = 8 * 1024, MAX_PIECES = 256;
const powerOfTwo = n => (n <= 1 ? 1 : Math.min(MAX_PIECES, 2 ** Math.round(Math.log2(n))));

/**
 * A set as stored: [title, year, maker, cloneOf, romOf, flags, roms, order]. A ROM its romOf chain
 * also has (same name, size and CRC) becomes its place there: i, or [depth, i] further along the
 * chain; the cabinet controls (MAME's 8th field) are left out (public/assets/arcade-input.json has them).
 */
export function encodeSet(games, name, order) {
  const game = games[name];
  const roms = game[ROMS].map(rom => {
    const [romName, size, crc, merge] = rom;
    if (merge && merge === romName) {
      let parent = game[ROM_OF];
      const seen = new Set();
      for (let depth = 0; parent && games[parent] && !seen.has(parent) && depth < 8; depth++) {
        seen.add(parent);
        const index = games[parent][ROMS].findIndex(p => p[0] === merge && p[1] === size && p[2] === crc);
        if (index >= 0) return depth ? [depth, index] : index;
        parent = games[parent][ROM_OF];
      }
    }
    return merge ? [romName, size, crc, merge] : [romName, size, crc];
  });
  return [...game.slice(0, ROMS), roms, order];
}

/**
 * For every ROM checksum, the sets that have it as "set:files" (files = the set's file count),
 * with "*k" when the set has it k times — what identifyArcadeZip scores a renamed zip with.
 * BIOS and non-runnable sets are never a renamed zip's match and are left out.
 */
export function crcIndex(games) {
  const index = new Map();
  for (const [name, game] of Object.entries(games)) {
    if (game[FLAGS] & 5 || !game[ROMS].length) continue;
    const counts = new Map();
    for (const rom of game[ROMS]) counts.set(rom[2], (counts.get(rom[2]) || 0) + 1);
    for (const [crc, times] of counts) {
      if (!index.has(crc)) index.set(crc, []);
      index.get(crc).push(`${name}:${game[ROMS].length}${times > 1 ? `*${times}` : ''}`);
    }
  }
  return index;
}

/** All pieces of one core: { meta, files: { 's0.json': {...}, 'f0.json': {...}, 'c0.json': {...} } }. */
export function shardCatalog(catalog) {
  const games = catalog.games;
  const names = Object.keys(games);
  const encoded = names.map((name, order) => [name, encodeSet(games, name, order)]);
  const size = encoded.reduce((sum, [name, record]) => sum + name.length + JSON.stringify(record).length + 4, 0);
  const buckets = powerOfTwo(size / SET_PIECE);
  const files = {};
  for (const [name, record] of encoded) (files[`s${setBucket(name, buckets)}.json`] ||= {})[name] = record;
  const index = crcIndex(catalog.games);
  const crcSize = [...index].reduce((sum, [crc, sets]) => sum + crc.length + sets.join(' ').length + 6, 0);
  const crcBuckets = powerOfTwo(crcSize / CRC_PIECE);
  for (const [crc, sets] of [...index].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    (files[`c${crcBucket(crc, crcBuckets)}.json`] ||= {})[crc] = sets.join(' ');
  }
  for (let b = 0; b < buckets; b++) files[`s${b}.json`] ||= {};
  for (let b = 0; b < crcBuckets; b++) files[`c${b}.json`] ||= {};
  return { meta: { label: catalog.label, version: catalog.version, sets: names.length, buckets, crcBuckets }, files };
}

/** Writes every core's pieces and index.json under `outDir` (the folder served as /assets/arcade). */
export function writeArcadeShards(outDir, dataDir = DATA_DIR) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const cores = {};
  let count = 0, bytes = 0;
  for (const [coreId, file] of Object.entries(ARCADE_LISTS)) {
    const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    const { meta, files } = shardCatalog(catalog);
    cores[coreId] = meta;
    fs.mkdirSync(path.join(outDir, coreId), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const json = JSON.stringify(content);
      fs.writeFileSync(path.join(outDir, coreId, name), json);
      count++; bytes += json.length;
    }
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ format: 1, cores }));
  return { cores, files: count + 1, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node scripts/arcade-shards.mjs <output folder>'); process.exit(2); }
  const result = writeArcadeShards(path.resolve(out));
  console.log(JSON.stringify(result.cores), `${result.files} files, ${(result.bytes / 1e6).toFixed(2)} MB`);
}

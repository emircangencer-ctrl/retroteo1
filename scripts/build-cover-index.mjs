// Builds RetroPlay's cover-art name lists from the libretro-thumbnails repositories (the box art
// RetroArch shows), so a game finds its picture by name. Only names are stored: the pictures are
// fetched by the app from raw.githubusercontent.com when a game is added (CORS-enabled), at the
// commit the list was made from, so a list and its pictures always agree.
// Console lists also map ROM checksums (No-Intro, from libretro-database) to names, the way
// RetroArch recognises games: a ROM finds its cover whatever its file is called.
//
//   node scripts/build-cover-index.mjs <folder with thumbnail clones> <libretro-database clone>
//
// Clone each thumbnail repository without its pictures:
//   git clone --filter=blob:none --no-checkout --depth 1 https://github.com/libretro-thumbnails/<repo>.git
// and from libretro-database only metadat/no-intro/<system>.dat (same clone options, then
// git checkout HEAD -- "<path>").
// Symbolic links (one picture shared by several names) are resolved to the file they point to,
// because raw.githubusercontent.com serves a link's target path, not the picture.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCover } from '../src/lib/covers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'public', 'assets', 'covers');

/** RetroPlay cover sets: file key → libretro-thumbnails repository. */
export const COVER_REPOS = Object.freeze({
  nes: 'Nintendo_-_Nintendo_Entertainment_System',
  snes: 'Nintendo_-_Super_Nintendo_Entertainment_System',
  md: 'Sega_-_Mega_Drive_-_Genesis',
  fbneo: 'FBNeo_-_Arcade_Games',
  mame: 'MAME'
});
const TYPES = Object.freeze({ boxarts: 'Named_Boxarts', titles: 'Named_Titles' });
/** No-Intro lists for the console sets (libretro-database/metadat/no-intro). */
export const CRC_DATS = Object.freeze({
  nes: 'Nintendo - Nintendo Entertainment System.dat',
  snes: 'Nintendo - Super Nintendo Entertainment System.dat',
  md: 'Sega - Mega Drive - Genesis.dat'
});
/**
 * ROM checksums of a clrmamepro dat: [{ name, crcs }]. NES lists carry each game twice, with and
 * without its 16-byte header; only the headerless one is kept (headers differ between copies of the
 * same cartridge, its data does not), unless a game has no headerless entry.
 */
export function datChecksums(text, { headerless = false } = {}) {
  const games = new Map();
  for (const block of text.matchAll(/^game \(\n\tname "((?:[^"\\]|\\.)*)"[\s\S]*?^\)/gm)) {
    const name = block[1].replace(/\\(.)/g, '$1');
    const roms = games.get(name) || [];
    for (const r of block[0].matchAll(/rom \( name "((?:[^"\\]|\\.)*)" size \d+ crc ([0-9A-Fa-f]{8})/g)) roms.push({ ext: r[1].split('.').pop().toLowerCase(), crc: r[2].toUpperCase() });
    games.set(name, roms);
  }
  return [...games].map(([name, roms]) => {
    const kept = headerless && roms.some(r => r.ext === 'unh') ? roms.filter(r => r.ext === 'unh') : roms;
    return { name, crcs: [...new Set(kept.map(r => r.crc))] };
  }).filter(game => game.crcs.length);
}

/**
 * { CRC: picture } for an index: box art i, or title screen -1 - i. The picture is the one the app
 * would find for the No-Intro name (src/lib/covers.ts findCover); games without one are left out.
 */
export function crcTable(index, games) {
  const box = new Map(index.boxarts.map((stem, i) => [stem, i]));
  const title = new Map(index.titles.map((stem, i) => [stem, i]));
  const table = {};
  for (const { name, crcs } of games) {
    const match = findCover(index, [name]);
    if (!match) continue;
    const value = match.type === 'boxarts' ? box.get(match.stem) : -1 - title.get(match.stem);
    for (const crc of crcs) if (!(crc in table)) table[crc] = value;
  }
  return table;
}

/**
 * Compact list for one repository: { repo, boxarts: [stem…], titles: [stem…], links: { "b:stem": "target stem" } }.
 * Names with "[…]" (GoodTools/TOSEC dump marks: bad dumps, hacks, translations) are left out; the
 * clean name of the same game is matched instead.
 */
export function coverIndex(repo, entries, linkTargets = new Map()) {
  const out = { repo, boxarts: [], titles: [], links: {} };
  for (const [key, dir] of Object.entries(TYPES)) {
    const prefix = `${dir}/`;
    for (const { mode, file } of entries) {
      if (!file.startsWith(prefix) || !file.endsWith('.png')) continue;
      const stem = file.slice(prefix.length, -4);
      if (!stem || stem.includes('/') || stem.includes('[')) continue;
      out[key].push(stem);
      if (mode === '120000') {
        const target = linkTargets.get(file);
        if (target) {
          const resolved = path.posix.normalize(path.posix.join(dir, target));
          if (resolved.startsWith(prefix) && resolved.endsWith('.png')) out.links[`${key[0]}:${stem}`] = resolved.slice(prefix.length, -4);
        }
      }
    }
    out[key].sort();
  }
  return out;
}

function gitEntries(dir) {
  return execFileSync('git', ['-C', dir, 'ls-tree', '-r', '-z', 'HEAD'], { maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean).map(line => {
    const [meta, file] = line.split('\t');
    const [mode, , sha] = meta.split(' ');
    return { mode, sha, file };
  });
}

function linkTargetsOf(dir, entries) {
  const links = entries.filter(e => e.mode === '120000' && /^Named_(Boxarts|Titles)\//.test(e.file));
  const targets = new Map();
  if (!links.length) return targets;
  const raw = execFileSync('git', ['-C', dir, 'cat-file', '--batch'], { input: links.map(e => e.sha).join('\n') + '\n', maxBuffer: 1 << 26 });
  let at = 0;
  for (const link of links) {
    const end = raw.indexOf(10, at);
    const [, , size] = raw.subarray(at, end).toString('utf8').split(' ');
    const content = raw.subarray(end + 1, end + 1 + Number(size)).toString('utf8');
    targets.set(link.file, content.trim());
    at = end + 1 + Number(size) + 1;
  }
  return targets;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, database] = process.argv.slice(2);
  if (!base || !database) { console.error('usage: node scripts/build-cover-index.mjs <folder with thumbnail clones> <libretro-database clone>'); process.exit(2); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [key, repo] of Object.entries(COVER_REPOS)) {
    const dir = path.join(base, repo);
    const entries = gitEntries(dir);
    const index = coverIndex(repo, entries, linkTargetsOf(dir, entries));
    index.ref = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
    if (CRC_DATS[key]) {
      const text = fs.readFileSync(path.join(database, 'metadat', 'no-intro', CRC_DATS[key]), 'utf8');
      index.crc = crcTable(index, datChecksums(text, { headerless: key === 'nes' }));
    }
    const json = JSON.stringify(index);
    fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), json);
    const crcs = Object.values(index.crc || {});
    console.log(`${key}: ${index.boxarts.length} box arts, ${index.titles.length} title screens, ${Object.keys(index.links).length} links, ${crcs.length} checksums (${crcs.filter(v => v >= 0).length} box art, ${crcs.filter(v => v < 0).length} title screen), ${(json.length / 1e3).toFixed(0)} KB`);
  }
}

// Cover art from libretro-thumbnails (the box art RetroArch shows). The lists come with the app
// (/assets/covers/*.json, made by scripts/build-cover-index.mjs). A console game is recognised by
// its ROM checksum (No-Intro, as RetroArch does), then by name; an arcade game by name. The picture
// is fetched once from raw.githubusercontent.com (CORS-enabled) at the commit the list was made
// from, so list and pictures always agree. This file only finds pictures; storing them is
// cover-art.svelte.ts.
import { splitTitle } from './title.ts';
import { titleFromFileName } from './format.ts';
import { crc32 } from '../nes-rom.js';
import type { Game } from './types.ts';

export const COVER_BASE = 'https://raw.githubusercontent.com/libretro-thumbnails';

export type CoverType = 'boxarts' | 'titles';
export interface CoverIndex {
  repo: string;
  /** Commit of the thumbnail repository the list was made from. */
  ref?: string;
  boxarts: string[];
  titles: string[];
  /** "b:stem" / "t:stem" → the file a symbolic link points to. */
  links: Record<string, string>;
  /** ROM CRC32 → box art i, or title screen -1 - i. */
  crc?: Record<string, number>;
}
export interface CoverMatch { repo: string; type: CoverType; stem: string; url: string; by: 'checksum' | 'name' }

/** Which lists a game is looked up in, best first. */
export function coverSets(game: Pick<Game, 'platform' | 'arcade'>): string[] {
  switch (game.platform) {
    case 'NES': return ['nes'];
    case 'SNES': return ['snes'];
    case 'MD': return ['md'];
    case 'ARCADE': return String(game.arcade?.core || '').startsWith('fb') ? ['fbneo', 'mame'] : ['mame', 'fbneo'];
    default: return [];
  }
}

/** Names to look for: the file's own name (it keeps No-Intro regions), then the library title. */
export function coverCandidates(game: Pick<Game, 'title' | 'fileName' | 'platform'>): string[] {
  const fromFile = game.platform !== 'ARCADE' && game.fileName ? titleFromFileName(game.fileName) : '';
  return [...new Set([fromFile, game.title].map(name => String(name || '').trim()).filter(Boolean))];
}

// libretro-thumbnails file names have _ in place of & * / : ` < > ? \ | and ".
export const thumbnailName = (name: string): string => name.replace(/[&*/:`<>?\\|"]/g, '_');

/** "Legend of Zelda, The - A Link to the Past" → "The Legend of Zelda - A Link to the Past". */
function articleFirst(name: string): string {
  return name.replace(/^(.+?), (The|A|An)\b(?=$| - |\s*\()/i, '$2 $1');
}
/** Letters and digits only, lower case, article first: "PuckMan (Japan, set 1)" = "Puck Man (Japan set 1)". */
export const looseKey = (name: string): string => articleFirst(name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const baseKey = (name: string): string => looseKey(splitTitle(articleFirst(name)).name);

// Versions that make a poor cover for someone who did not ask for them.
const UNWANTED = /\b(pirate|hack|proto|prototype|beta|demo|sample|unl|bootleg|virtual console|collection|classic mini|switch online|aftermarket|homebrew|program)\b/i;
const REGION_ORDER = ['world', 'usa', 'europe', 'japan'];

function tags(name: string): string[] {
  return splitTitle(name).detail.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Of several versions of one game: the one closest to the candidate's own tags, clean releases first. */
function rank(candidate: string, stems: string[]): string {
  const want = new Set(tags(candidate));
  const unwantedOk = UNWANTED.test(candidate);
  const score = (stem: string) => {
    const have = tags(stem);
    let s = 0;
    for (const t of have) if (want.has(t)) s += 10;
    if (!unwantedOk && UNWANTED.test(stem)) s -= 50;
    const region = REGION_ORDER.findIndex(r => have.includes(r));
    if (region >= 0) s += REGION_ORDER.length - region;
    return s - have.length * 0.5;
  };
  let best = stems[0], bestScore = -Infinity;
  for (const stem of stems) {
    const s = score(stem);
    if (s > bestScore || (s === bestScore && (stem.length < best.length || (stem.length === best.length && stem < best)))) { best = stem; bestScore = s; }
  }
  return best;
}

interface Lookup { exact: Set<string>; loose: Map<string, string>; base: Map<string, string[]> }
const lookups = new WeakMap<CoverIndex, Record<CoverType, Lookup>>();
function lookupOf(index: CoverIndex): Record<CoverType, Lookup> {
  let entry = lookups.get(index);
  if (!entry) {
    const build = (list: string[]): Lookup => {
      const loose = new Map<string, string>(), base = new Map<string, string[]>();
      for (const stem of list) {
        const lk = looseKey(stem);
        if (!loose.has(lk)) loose.set(lk, stem);
        const bk = baseKey(stem);
        if (!bk) continue;
        const same = base.get(bk);
        if (same) same.push(stem); else base.set(bk, [stem]);
      }
      return { exact: new Set(list), loose, base };
    };
    entry = { boxarts: build(index.boxarts), titles: build(index.titles) };
    lookups.set(index, entry);
  }
  return entry;
}

export function coverUrl(index: CoverIndex, type: CoverType, stem: string): string {
  const file = index.links[`${type[0]}:${stem}`] || stem;
  return `${COVER_BASE}/${index.repo}/${index.ref || 'master'}/${type === 'boxarts' ? 'Named_Boxarts' : 'Named_Titles'}/${encodeURIComponent(file)}.png`;
}

/**
 * A game's picture in one list by name: box art before title screen; for each, the exact name, the
 * same letters and digits, then another version of the same game (closest region and tags).
 */
export function findCover(index: CoverIndex, candidates: string[]): CoverMatch | null {
  const lookup = lookupOf(index);
  const names = candidates.map(thumbnailName).filter(Boolean);
  for (const type of ['boxarts', 'titles'] as const) {
    const l = lookup[type];
    let stem = names.find(name => l.exact.has(name));
    for (const name of names) if (!stem) stem = l.loose.get(looseKey(name));
    for (const name of names) {
      if (stem) break;
      const same = l.base.get(baseKey(name));
      if (same?.length) stem = rank(name, same);
    }
    if (stem) return { repo: index.repo, type, stem, url: coverUrl(index, type, stem), by: 'name' };
  }
  return null;
}

/** A game's picture in one list by ROM checksum (8 upper-case hex digits). */
export function findCoverByChecksum(index: CoverIndex, checksums: string[]): CoverMatch | null {
  if (!index.crc) return null;
  for (const crc of checksums) {
    const at = index.crc[crc];
    if (typeof at !== 'number') continue;
    const type: CoverType = at >= 0 ? 'boxarts' : 'titles';
    const stem = type === 'boxarts' ? index.boxarts[at] : index.titles[-1 - at];
    if (stem) return { repo: index.repo, type, stem, url: coverUrl(index, type, stem), by: 'checksum' };
  }
  return null;
}

const hex = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/**
 * The checksums No-Intro lists a console ROM under: NES without its 16-byte iNES header (headers
 * differ between copies of one cartridge), SNES without a 512-byte copier header, Mega Drive as is.
 */
export function romChecksums(platform: string, bytes: Uint8Array): string[] {
  if (!bytes?.length) return [];
  if (platform === 'NES') {
    const ines = bytes.length > 16 && bytes[0] === 0x4e && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1a;
    return ines ? [hex(crc32(bytes.subarray(16))), hex(crc32(bytes))] : [hex(crc32(bytes))];
  }
  if (platform === 'SNES' && bytes.length % 1024 === 512) return [hex(crc32(bytes.subarray(512))), hex(crc32(bytes))];
  return [hex(crc32(bytes))];
}

const indexCache = new Map<string, Promise<CoverIndex>>();
/** One list (loaded once; cached by the service worker like the other app files). */
export function loadCoverIndex(key: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<CoverIndex> {
  let pending = indexCache.get(key);
  if (!pending) {
    pending = fetchImpl(`/assets/covers/${key}.json`).then(response => {
      if (!response.ok) throw new Error(`Kapak listesi yüklenemedi (${response.status}).`);
      return response.json() as Promise<CoverIndex>;
    });
    pending.catch(() => indexCache.delete(key));
    indexCache.set(key, pending);
  }
  return pending;
}

/** A game's cover: by checksum first (consoles), then by name, in each of its lists. */
export async function matchCover(game: Game, { checksums = [] as string[], fetchImpl = globalThis.fetch }: { checksums?: string[]; fetchImpl?: typeof fetch } = {}): Promise<CoverMatch | null> {
  const candidates = coverCandidates(game);
  const indexes: CoverIndex[] = [];
  for (const key of coverSets(game)) indexes.push(await loadCoverIndex(key, fetchImpl));
  for (const index of indexes) {
    const match = findCoverByChecksum(index, checksums);
    if (match) return match;
  }
  if (!candidates.length) return null;
  for (const index of indexes) {
    const match = findCover(index, candidates);
    if (match) return match;
  }
  return null;
}

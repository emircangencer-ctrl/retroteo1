// The arcade game lists, read in small pieces. The full lists (data/arcade/*.json, 11 MB) are cut
// by the build (scripts/arcade-shards.mjs) into pieces by set name and an index from ROM checksum
// to the sets with that file, so recognising a zip reads only what it needs: its set, the parent
// and BIOS sets that set points to and, where a core has no set of that name or the zip does not
// fill it, the index entries of the zip's checksums — which find the best-fitting set without
// reading any set — and that set. Each piece is fetched once (and kept by the service worker);
// results equal those of identifyArcadeZip over the full lists (tests/arcade-catalog.test.mjs).
import { ARCADE_CORE_ORDER, identifyArcadeZip, validateSet } from './arcade.js';

/** The lists' stamp (vite.config.js): in every address, so a cached piece of other lists is never used. */
const LISTS = typeof __ARCADE_LISTS__ === 'string' ? __ARCADE_LISTS__ : '';
const versioned = url => (LISTS ? `${url}?v=${LISTS}` : url);
export const ARCADE_INDEX_URL = '/assets/arcade/index.json';
const ROM_OF = 4, FLAGS = 5, ROMS = 6, ORDER = 7;
const FLAG_BIOS = 1, FLAG_NOT_RUNNABLE = 4;

/** Which piece a set name is in (FNV-1a, so the build and the app agree). */
export function setBucket(name, buckets) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { hash ^= name.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return buckets > 1 ? hash % buckets : 0;
}
/** Which checksum piece a CRC32 (8 hex digits) is in. */
export const crcBucket = (crc, buckets) => (buckets > 1 ? Number.parseInt(crc.slice(0, 2), 16) % buckets : 0);
export const setUrl = (coreId, bucket) => `/assets/arcade/${coreId}/s${bucket}.json`;
export const crcUrl = (coreId, bucket) => `/assets/arcade/${coreId}/c${bucket}.json`;
/**
 * A stored set back in the full form [title, year, maker, cloneOf, romOf, flags, roms]. A ROM shared
 * with the set's parent or BIOS (same name, size and CRC) is stored as its place in that set's list:
 * i (the set romOf points to) or [depth, i] further along the romOf chain.
 */
export function decodeSet(record, chain) {
  const roms = record[ROMS].map(rom => {
    if (typeof rom === 'number' || typeof rom[0] === 'number') {
      const [depth, index] = typeof rom === 'number' ? [0, rom] : rom;
      const source = chain[depth]?.[ROMS]?.[index];
      if (!source) throw new Error('Arcade oyun listesi tutarsız.');
      return [source[0], source[1], source[2], source[0]];
    }
    return [rom[0], rom[1], rom[2], rom[3] || ''];
  });
  return [...record.slice(0, ROMS), roms];
}

const normalCrc = crc => String(crc || '').toLowerCase().padStart(8, '0');
const setNameOf = fileName => String(fileName || '').replace(/\\/g, '/').split('/').pop().replace(/\.(zip|7z)$/i, '').toLowerCase();

/** A reader over the pieces; `fetchImpl` is injectable for tests. */
export function createArcadeCatalogs(fetchImpl = (...args) => globalThis.fetch(...args)) {
  const files = new Map();
  const raw = new Map(); // `${core}/${set}` → stored record, or null when the core has no such set
  const decoded = new Map();
  let manifest = null;

  function json(url) {
    if (!files.has(url)) {
      const pending = fetchImpl(versioned(url)).then(response => {
        if (!response.ok) throw new Error(`sunucu ${response.status} döndü`);
        return response.json();
      });
      pending.catch(() => files.delete(url));
      files.set(url, pending);
    }
    return files.get(url);
  }

  async function index() {
    if (!manifest) {
      manifest = json(ARCADE_INDEX_URL);
      manifest.catch(() => { manifest = null; });
    }
    return manifest;
  }

  /** Loads these sets of a core and every set their romOf chains reach. */
  async function load(coreId, names) {
    const core = (await index()).cores[coreId];
    if (!core) return;
    let wanted = [...new Set(names)].filter(name => name && !raw.has(`${coreId}/${name}`));
    for (let round = 0; wanted.length && round < 8; round++) {
      const buckets = [...new Set(wanted.map(name => setBucket(name, core.buckets)))];
      const pieces = await Promise.all(buckets.map(bucket => json(setUrl(coreId, bucket)).then(piece => [bucket, piece])));
      const byBucket = new Map(pieces);
      const next = [];
      for (const name of wanted) {
        const record = byBucket.get(setBucket(name, core.buckets))?.[name] || null;
        raw.set(`${coreId}/${name}`, record);
        const parent = record?.[ROM_OF];
        if (parent && !raw.has(`${coreId}/${parent}`)) next.push(parent);
      }
      wanted = [...new Set(next)];
    }
  }

  function chainOf(coreId, record) {
    const chain = [];
    const seen = new Set();
    let parent = record[ROM_OF];
    while (parent && !seen.has(parent) && chain.length < 8) {
      seen.add(parent);
      const stored = raw.get(`${coreId}/${parent}`);
      if (!stored) break;
      chain.push(set(coreId, parent));
      parent = stored[ROM_OF];
    }
    return chain;
  }

  /** A loaded set in full form, or null. */
  function set(coreId, name) {
    const key = `${coreId}/${name}`;
    if (!decoded.has(key)) {
      const record = raw.get(key);
      decoded.set(key, record ? decodeSet(record, chainOf(coreId, record)) : null);
    }
    return decoded.get(key);
  }

  /**
   * The sets a renamed zip fits best in one core, scored from the checksum index exactly as
   * identifyArcadeZip scores them (every set with the top score, so ties are broken as there).
   */
  async function bestFits(coreId, crcs) {
    const core = (await index()).cores[coreId];
    if (!core) return [];
    const zipCrcs = new Set(crcs.map(crc => String(crc).toLowerCase()));
    if (!zipCrcs.size) return [];
    const pieces = [...new Set([...zipCrcs].map(crc => crcBucket(crc, core.crcBuckets)))];
    const byPiece = new Map(await Promise.all(pieces.map(bucket => json(crcUrl(coreId, bucket)).then(piece => [bucket, piece]))));
    const sets = new Map(); // name → { files, hits }
    for (const crc of zipCrcs) {
      for (const entry of String(byPiece.get(crcBucket(crc, core.crcBuckets))?.[crc] || '').split(' ')) {
        const match = /^(.+):(\d+)(?:\*(\d+))?$/.exec(entry);
        if (!match) continue;
        const set = sets.get(match[1]) || { files: Number(match[2]), hits: 0 };
        set.hits += Number(match[3] || 1);
        sets.set(match[1], set);
      }
    }
    let best = 0;
    const scored = [];
    for (const [name, { files, hits }] of sets) {
      const score = hits / files + hits / Math.max(zipCrcs.size, files);
      if (hits >= Math.min(3, files)) { scored.push([name, score]); if (score > best) best = score; }
    }
    return scored.filter(([, score]) => score === best).map(([name]) => name);
  }

  /** The part of each core's list a game can be recognised with: { core: { games } }, as the full lists. */
  function partial(coreId, names) {
    const all = new Set();
    for (const name of names) {
      let current = name;
      while (current && !all.has(current) && raw.get(`${coreId}/${current}`)) { all.add(current); current = raw.get(`${coreId}/${current}`)[ROM_OF]; }
    }
    // The full lists' order, so ties are broken as they were.
    const ordered = [...all].sort((a, b) => raw.get(`${coreId}/${a}`)[ORDER] - raw.get(`${coreId}/${b}`)[ORDER]);
    return { games: Object.fromEntries(ordered.map(name => [name, set(coreId, name)])) };
  }

  /** Every core's list as far as recognising this zip needs it. */
  async function catalogsFor(fileName, entries) {
    const { cores } = await index();
    const ids = ARCADE_CORE_ORDER.filter(id => cores[id]);
    const name = setNameOf(fileName);
    await Promise.all(ids.map(id => load(id, [name])));
    const names = Object.fromEntries(ids.map(id => [id, [name]]));
    const bios = ids.some(id => (raw.get(`${id}/${name}`)?.[FLAGS] || 0) & (FLAG_BIOS | FLAG_NOT_RUNNABLE));
    if (!bios && entries?.length) {
      // As identifyArcadeZip: where the zip's name is no set of the core, or a set it does not
      // fill, the set its checksums fit best is a candidate.
      const needed = ids.filter(id => {
        if (!raw.get(`${id}/${name}`)) return true;
        return validateSet(partial(id, [name]), name, entries)?.status === 'incomplete';
      });
      await Promise.all(needed.map(async id => {
        const fits = await bestFits(id, entries.map(entry => entry.crc));
        await load(id, fits);
        names[id].push(...fits);
      }));
    }
    return Object.fromEntries(ids.map(id => [id, partial(id, names[id])]));
  }

  return {
    catalogsFor,
    /** identifyArcadeZip with only the pieces this zip needs. */
    async identify(fileName, entries) {
      if (!entries?.length) return null;
      return identifyArcadeZip(fileName, entries, await catalogsFor(fileName, entries));
    },
    /** One set of one core with its romOf chain, as { games } (null when the core has no such set). */
    async setCatalog(coreId, name) {
      await load(coreId, [name]);
      return raw.get(`${coreId}/${name}`) ? partial(coreId, [name]) : null;
    }
  };
}

const shared = createArcadeCatalogs();
export const identifyArcade = (fileName, entries) => shared.identify(fileName, entries);
export const arcadeSetCatalog = (coreId, name) => shared.setCatalog(coreId, name);

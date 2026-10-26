// Arcade ROM sets: recognising a zip, checking it against the exact core build, choosing the core.
//
// Arcade emulators identify a game by its set name (the zip name, e.g. "mslug.zip") and load the
// ROM files inside by name/CRC32. A set only works if it matches the core's own ROM set version,
// so RetroPlay ships the game lists (set name, title, ROM sizes and CRC32s) of the cores it serves:
// FinalBurn Neo v1.0.0.03, FB Alpha 2012 CPS2, MAME 2003-Plus and RetroPlay's own build of the
// current MAME 2003-Plus for Namco System 12 (scripts/build-arcade-catalogs.mjs).
// FB Alpha 2012 CPS2 carries the CPS2 decryption keys itself, so it runs CPS2 sets from before
// MAME 0.178 (2016) that have no .key file, which FinalBurn Neo and MAME 2003-Plus cannot start.

export const ARCADE_CORES = Object.freeze({
  fbneo: Object.freeze({ id: 'fbneo', label: 'FinalBurn Neo', systemId: 'arcade', catalog: '/assets/arcade-fbneo.json' }),
  mame2003_plus: Object.freeze({ id: 'mame2003_plus', label: 'MAME 2003-Plus', systemId: 'mame', catalog: '/assets/arcade-mame2003plus.json' }),
  // RetroPlay's own build of the current MAME 2003-Plus (.github/workflows/cores.yml). Its list holds
  // only the drivers it runs better than the 2025 build (Namco System 12: full CPU clock, sound), and
  // a set it can run is started with it even when the older build also knows the zip.
  mame2003_plus_next: Object.freeze({ id: 'mame2003_plus_next', label: 'MAME 2003-Plus (2026)', systemId: 'mame', catalog: '/assets/arcade-mame2003plus-next.json', supersedes: 'mame2003_plus' }),
  // Its loader opens every zip a clone names (clone and parent) before looking at files.
  fbalpha2012_cps2: Object.freeze({ id: 'fbalpha2012_cps2', label: 'FB Alpha 2012 CPS2', systemId: 'arcade', catalog: '/assets/arcade-fba2012-cps2.json', opensParentZip: true })
});
const CORE_ORDER = Object.freeze(['fbneo', 'fbalpha2012_cps2', 'mame2003_plus_next', 'mame2003_plus']);

// Game tuple indexes (see compactDat in scripts/build-arcade-catalogs.mjs).
const TITLE = 0, YEAR = 1, MAKER = 2, CLONE_OF = 3, ROM_OF = 4, FLAGS = 5, ROMS = 6;
const FLAG_BIOS = 1, FLAG_VERTICAL = 2, FLAG_NOT_RUNNABLE = 4;

/**
 * BIOS files FinalBurn Neo cannot start without. For neogeo.zip only one of the many BIOS
 * versions is required (FBNeo d_neogeo.cpp: sp-s3.sp1 is the one not marked optional).
 */
const MANDATORY_BIOS_FILES = Object.freeze({
  neogeo: Object.freeze([
    ['sp-s3.sp1', '91b64be3', 'MVS Asia/Europe ver. 6 (1 slot)'],
    ['sm1.sm1', '94416d67', 'Z80 BIOS'],
    ['sfix.sfix', 'c2ea0cfd', 'yazı katmanı'],
    ['000-lo.lo', '5a86cff2', 'zoom tablosu']
  ])
});

export const KNOWN_BIOS_LABELS = Object.freeze({
  neogeo: 'Neo Geo BIOS',
  pgm: 'PGM (PolyGame Master) BIOS',
  skns: 'Super Kaneko Nova System BIOS',
  decocass: 'DECO Cassette BIOS',
  isgsm: 'ISG Selection Master BIOS',
  bubsys: 'Bubble System BIOS'
});

const catalogCache = new Map();

/** Loads a core's game list (once). `fetchImpl` is injectable for tests. */
export function loadCatalog(coreId, fetchImpl = globalThis.fetch) {
  const core = ARCADE_CORES[coreId];
  if (!core) return Promise.reject(new Error(`Bilinmeyen arcade çekirdeği: ${coreId}`));
  if (!catalogCache.has(coreId)) {
    catalogCache.set(coreId, fetchImpl(core.catalog).then(response => {
      if (!response.ok) throw new Error(`${core.label} oyun listesi yüklenemedi (${response.status}).`);
      return response.json();
    }).catch(error => { catalogCache.delete(coreId); throw error; }));
  }
  return catalogCache.get(coreId);
}
export async function loadCatalogs(fetchImpl) {
  const entries = await Promise.all(CORE_ORDER.map(async id => [id, await loadCatalog(id, fetchImpl)]));
  return Object.fromEntries(entries);
}

const setNameOf = fileName => String(fileName || '').replace(/\\/g, '/').split('/').pop().replace(/\.(zip|7z)$/i, '').toLowerCase();
const isBiosGame = game => Boolean(game && (game[FLAGS] & (FLAG_BIOS | FLAG_NOT_RUNNABLE)));

/** The BIOS set a game needs (following clone → parent → BIOS), or ''. */
export function biosOf(catalog, setName) {
  const games = catalog.games;
  let current = games[setName];
  const seen = new Set([setName]);
  while (current && current[ROM_OF] && !seen.has(current[ROM_OF])) {
    const next = current[ROM_OF];
    seen.add(next);
    if (isBiosGame(games[next])) return next;
    current = games[next];
  }
  return '';
}

const baseName = name => String(name || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
const isKeyFile = name => /\.key$/i.test(String(name || ''));
// CPS2 boards decrypt their program with a 20-byte key. MAME 0.178 (2016) moved these keys into
// the ROM sets and FinalBurn Neo and MAME 2003-Plus followed, so older CPS2 sets lack them.
const CPS2_KEY_SIZE = 20;

/**
 * Whether every file a set lacks is a decryption key (e.g. an old CPS2 set without its .key):
 * no core can start it, and the fix is a newer copy of the same set.
 * Works on validateSet results and on library records ({ missing, missingCount }).
 */
export function onlyKeysMissing(arcade) {
  const missing = arcade?.missing || [];
  if (arcade?.status !== 'incomplete' || !missing.length) return false;
  if ((arcade.missingCount ?? missing.length) !== missing.length) return false;
  return missing.every(isKeyFile);
}

/** Whether a missing key is a 20-byte CPS2 key, looked up in a catalog (for older library records). */
export function isCps2KeyMissing(catalog, setName, missing) {
  const roms = catalog?.games?.[setName]?.[ROMS] || [];
  return (missing || []).some(name => isKeyFile(name) && roms.some(rom => rom[0] === name && rom[1] === CPS2_KEY_SIZE));
}

/** For each missing key: is it absent from the zip, or present under its name with other contents? */
export function keyFindings(missing, entries) {
  const named = new Set((entries || []).map(entry => baseName(entry.name)));
  const keys = (missing || []).filter(isKeyFile);
  return { absent: keys.filter(name => !named.has(baseName(name))), different: keys.filter(name => named.has(baseName(name))) };
}

/**
 * Checks a set's files against a zip's entries ({ name, size, crc }).
 * status: complete | needs-parent (split set: files of the parent set are elsewhere) | incomplete
 */
export function validateSet(catalog, setName, entries) {
  const game = catalog.games[setName];
  if (!game) return null;
  const present = new Set(entries.map(entry => `${String(entry.crc).toLowerCase()}:${entry.size}`));
  const named = new Set(entries.map(entry => baseName(entry.name)));
  const bios = biosOf(catalog, setName);
  const biosCrcs = new Set((catalog.games[bios]?.[ROMS] || []).map(rom => rom[2]));
  const missingOwn = [];
  const missingParent = [];
  const different = [];
  const keys = [];
  let cps2Key = false;
  let required = 0;
  for (const [name, size, crc, merge] of game[ROMS]) {
    if (merge && biosCrcs.has(crc)) continue; // provided by the BIOS zip
    required++;
    if (present.has(`${crc}:${size}`)) continue;
    (merge ? missingParent : missingOwn).push(name);
    if (named.has(baseName(name))) different.push(name);
    if (!merge && isKeyFile(name)) { keys.push(name); if (size === CPS2_KEY_SIZE) cps2Key = true; }
  }
  const status = !missingOwn.length && !missingParent.length ? 'complete' : !missingOwn.length ? 'needs-parent' : 'incomplete';
  return {
    set: setName,
    status,
    required,
    missing: [...missingOwn, ...missingParent],
    different,
    keys,
    cps2Key,
    parent: game[CLONE_OF] || '',
    bios,
    title: game[TITLE],
    year: game[YEAR],
    manufacturer: game[MAKER],
    vertical: Boolean(game[FLAGS] & FLAG_VERTICAL)
  };
}

/** Which mandatory BIOS files a BIOS zip lacks (empty when it can be used). */
export function validateBios(catalog, biosName, entries) {
  const crcs = new Set(entries.map(entry => String(entry.crc).toLowerCase()));
  const mandatory = MANDATORY_BIOS_FILES[biosName] || (catalog?.games[biosName]?.[ROMS] || []).map(([name, , crc]) => [name, crc, '']);
  return mandatory.filter(([, crc]) => !crcs.has(crc)).map(([name, , label]) => (label ? `${name} (${label})` : name));
}

function bestByCrc(catalog, entries) {
  // A renamed zip: find the set whose files match most of the zip's CRC32s.
  const zipCrcs = new Set(entries.map(entry => String(entry.crc).toLowerCase()));
  if (!zipCrcs.size) return '';
  let best = '', bestScore = 0;
  for (const [name, game] of Object.entries(catalog.games)) {
    if (isBiosGame(game)) continue;
    const roms = game[ROMS];
    if (!roms.length) continue;
    let hits = 0;
    for (const rom of roms) if (zipCrcs.has(rom[2])) hits++;
    // Prefer the set the zip covers best, then the one with the fewest extra files.
    const score = hits / roms.length + hits / Math.max(zipCrcs.size, roms.length);
    if (hits >= Math.min(3, roms.length) && score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}

/**
 * Recognises a zip as an arcade game, an arcade BIOS, or neither.
 * Returns { kind: 'game', core, ...validation, renamedFrom, alternatives } | { kind: 'bios', set, label, missing } | null
 */
export function identifyArcadeZip(fileName, entries, catalogs) {
  if (!entries?.length) return null;
  const name = setNameOf(fileName);
  // BIOS sets are recognised by name (they are shared by many games).
  for (const coreId of CORE_ORDER) {
    const catalog = catalogs[coreId];
    if (catalog && isBiosGame(catalog.games[name])) {
      return { kind: 'bios', set: name, core: coreId, label: KNOWN_BIOS_LABELS[name] || catalog.games[name][TITLE], missing: validateBios(catalog, name, entries) };
    }
  }
  // Per core: the set named like the zip, and (for renamed zips) the set its CRC32s match best.
  const byName = {}, byCrc = {};
  for (const coreId of CORE_ORDER) {
    const catalog = catalogs[coreId];
    if (!catalog) continue;
    const named = validateSet(catalog, name, entries);
    if (named) byName[coreId] = { ...named, core: coreId };
    if (!named || named.status === 'incomplete') {
      const guess = bestByCrc(catalog, entries);
      const candidate = guess && guess !== name ? validateSet(catalog, guess, entries) : null;
      if (candidate && candidate.status !== 'incomplete') byCrc[coreId] = { ...candidate, core: coreId, renamedFrom: name };
    }
  }
  const usable = result => result && result.status !== 'incomplete';
  // An exact set name wins over a checksum guess; FinalBurn Neo first (faster, more accurate for
  // CPS and Neo Geo), then FB Alpha 2012 CPS2 (old CPS2 sets without .key), MAME 2003-Plus for the
  // rest; an incomplete named set is still kept so the player learns what is missing (the core's
  // set that lacks the fewest files: the version the zip is closest to).
  const order = [
    ...CORE_ORDER.map(id => byName[id]).filter(usable),
    ...CORE_ORDER.map(id => byCrc[id]).filter(usable),
    ...CORE_ORDER.map(id => byName[id]).filter(Boolean).sort((a, b) => a.missing.length - b.missing.length)
  ];
  let chosen = order[0];
  // A core that supersedes another takes the game over from it whenever it can run the set.
  for (const id of CORE_ORDER) {
    const over = ARCADE_CORES[id].supersedes;
    const result = usable(byName[id]) ? byName[id] : usable(byCrc[id]) ? byCrc[id] : null;
    if (over && result && (!chosen || chosen.core === over || !usable(chosen))) { chosen = result; break; }
  }
  if (!chosen) return null;
  const others = CORE_ORDER.filter(id => id !== chosen.core).map(id => (usable(byName[id]) ? byName[id] : byCrc[id] || byName[id])).filter(Boolean);
  const alternatives = others.map(result => ({ core: result.core, status: result.status, set: result.set }));
  return { kind: 'game', ...chosen, alternatives };
}

/** Touch layout for an arcade game: Neo Geo games use A B C D, everything else six buttons. */
export function arcadeLayout(arcade) {
  return arcade?.bios === 'neogeo' ? 'neogeo' : 'six';
}

/** Short Turkish status line for a recognised set. */
export function describeArcadeStatus(arcade, { biosInstalled = true, parentInstalled = true } = {}) {
  if (!arcade) return '';
  const core = ARCADE_CORES[arcade.core]?.label || arcade.core;
  const parts = [core];
  if (arcade.status === 'complete') parts.push('tam set');
  else if (arcade.status === 'needs-parent') parts.push(parentInstalled ? `ana set ${arcade.parent}.zip ile` : `ana set ${arcade.parent}.zip gerekli`);
  else if (onlyKeysMissing(arcade)) parts.push(`${arcade.cps2Key ? 'CPS2 şifre anahtarı' : 'şifre çözme anahtarı'} ${Array.isArray(arcade.different) && arcade.different.length ? 'farklı' : 'eksik'}: ${arcade.missing.join(', ')}`);
  else parts.push(missingSummary(arcade));
  if (arcade.bios) parts.push(biosInstalled ? `${arcade.bios}.zip BIOS hazır` : `${arcade.bios}.zip BIOS gerekli`);
  if (arcade.renamedFrom) parts.push(`dosya adı ${arcade.set}.zip olarak tanındı`);
  return parts.join(' · ');
}

/** "2 dosya eksik", "1 dosya farklı sürüm", … (older records without the split: "eksik veya farklı"). */
export function missingSummary(arcade) {
  const count = arcade?.missingCount ?? arcade?.missing?.length ?? 0;
  if (!Array.isArray(arcade?.different)) return `${count} dosya eksik veya farklı`;
  const different = arcade.different.length;
  const absent = Math.max(0, count - different);
  return [absent ? `${absent} dosya eksik` : '', different ? `${different} dosya farklı sürüm` : ''].filter(Boolean).join(', ') || `${count} dosya eksik`;
}

/**
 * Cabinet controls for a set from MAME 2003-Plus's list (by the set's name, then its parent's):
 * { buttons, ways } — e.g. Pac-Man { buttons: 0, ways: 4 }, 1942 { buttons: 2, ways: 8 } — or null.
 */
export function arcadeInputInfo(arcade, catalogs) {
  const mame = catalogs?.mame2003_plus?.games;
  if (!mame || !arcade) return null;
  // (the current MAME 2003-Plus build's sets, e.g. tekken3je1, are found through their parent)
  for (const name of [arcade.set, arcade.parent, ...(arcade.alternatives || []).map(alt => alt.set)]) {
    const input = name && mame[name]?.[7];
    if (Array.isArray(input)) return { buttons: Number(input[0]) || 0, ways: Number(input[1]) || 0 };
  }
  return null;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { identifyArcadeZip, validateSet, validateBios, biosOf, arcadeLayout, describeArcadeStatus, onlyKeysMissing, isCps2KeyMissing, keyFindings, missingSummary, wasmSimdSupported, arcadeCoreSupported } from '../src/arcade.js';
import { readZipDirectory } from '../src/zip-rom.js';
import { placeholderWithCrc, writeZip, crc32, placeholderSet } from '../e2e/fixtures/zip-writer.mjs';

// [title, year, maker, cloneof, romof, flags, roms[[name, size, crc, merge]]]
const fbneo = { games: {
  neogeo: ['Neo Geo', '1990', 'SNK', '', '', 1, [['sp-s3.sp1', 131072, '91b64be3', ''], ['sp-s2.sp1', 131072, '9036d879', ''], ['sm1.sm1', 131072, '94416d67', ''], ['sfix.sfix', 131072, 'c2ea0cfd', ''], ['000-lo.lo', 131072, '5a86cff2', '']]],
  mslug: ['Metal Slug', '1996', 'Nazca', '', 'neogeo', 0, [['201-p1.p1', 64, '11111111', ''], ['201-c1.c1', 64, '22222222', ''], ['201-m1.m1', 64, '33333333', '']]],
  puckman: ['Puck Man (Japan, set 1)', '1980', 'Namco', '', '', 2, [['pm1.6e', 32, 'aaaaaaaa', ''], ['pm1.6f', 32, 'bbbbbbbb', ''], ['pm1-1.7f', 32, 'cccccccc', '']]],
  pacman: ['Pac-Man (Midway)', '1980', 'Namco', 'puckman', 'puckman', 2, [['pacman.6e', 32, 'dddddddd', ''], ['pacman.6f', 32, 'eeeeeeee', ''], ['82s123.7f', 32, 'cccccccc', 'pm1-1.7f']]]
} };
const mame = { games: {
  neogeo: ['Neo-Geo', '1990', 'SNK', '', '', 4, [['sp-s2.sp1', 131072, '9036d879', '']]],
  zigzag: ['Zig Zag', '1982', 'LAX', '', '', 2, [['zz_d1.bin', 32, 'abababab', ''], ['zz_d2.bin', 32, 'cdcdcdcd', '']]],
  mslug: ['Metal Slug', '1996', 'Nazca', '', 'neogeo', 0, [['201-p1.bin', 64, '11111111', ''], ['sp-s2.sp1', 131072, '9036d879', 'sp-s2.sp1']]]
} };
const catalogs = { fbneo, mame2003_plus: mame };
const entriesOf = roms => roms.map(([name, size, crc]) => ({ name, size, crc }));

test('a complete non-merged set is recognised by its zip name and goes to FinalBurn Neo', () => {
  const result = identifyArcadeZip('puckman.zip', entriesOf(fbneo.games.puckman[6]), catalogs);
  assert.equal(result.kind, 'game');
  assert.equal(result.core, 'fbneo');
  assert.equal(result.status, 'complete');
  assert.equal(result.title, 'Puck Man (Japan, set 1)');
  assert.equal(result.vertical, true);
});

test('a renamed zip is recognised from its CRC32s', () => {
  const result = identifyArcadeZip('Puck Man (my copy).zip', entriesOf(fbneo.games.puckman[6]), catalogs);
  assert.equal(result.set, 'puckman');
  assert.equal(result.renamedFrom, 'puck man (my copy)');
  assert.match(describeArcadeStatus(result), /dosya adı puckman\.zip olarak tanındı/);
});

test('a split clone without the parent files needs the parent set', () => {
  const own = fbneo.games.pacman[6].filter(rom => !rom[3]);
  const result = validateSet(fbneo, 'pacman', entriesOf(own));
  assert.equal(result.status, 'needs-parent');
  assert.equal(result.parent, 'puckman');
  assert.equal(validateSet(fbneo, 'pacman', entriesOf(fbneo.games.pacman[6])).status, 'complete');
});

test('a set with a missing or different file is reported with the file names', () => {
  const entries = entriesOf(fbneo.games.puckman[6]).map(entry => (entry.name === 'pm1.6f' ? { ...entry, crc: '00000000' } : entry));
  const result = identifyArcadeZip('puckman.zip', entries, catalogs);
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.missing, ['pm1.6f']);
});

test('Neo Geo games need the neogeo BIOS; BIOS files inside a MAME set do not count as missing', () => {
  assert.equal(biosOf(fbneo, 'mslug'), 'neogeo');
  const fb = validateSet(fbneo, 'mslug', entriesOf(fbneo.games.mslug[6]));
  assert.equal(fb.status, 'complete');
  assert.equal(fb.bios, 'neogeo');
  const mameResult = validateSet(mame, 'mslug', [{ name: '201-p1.bin', size: 64, crc: '11111111' }]);
  assert.equal(mameResult.status, 'complete', 'the BIOS file listed in the MAME game entry is provided by neogeo.zip');
  assert.equal(arcadeLayout(fb), 'neogeo');
  assert.equal(arcadeLayout({ bios: '' }), 'six');
});

test('a set only MAME 2003-Plus knows goes to MAME 2003-Plus', () => {
  const result = identifyArcadeZip('zigzag.zip', entriesOf(mame.games.zigzag[6]), catalogs);
  assert.equal(result.core, 'mame2003_plus');
  assert.equal(result.status, 'complete');
});

test('neogeo.zip is recognised as a BIOS and checked for the files FinalBurn Neo cannot start without', () => {
  const full = identifyArcadeZip('neogeo.zip', entriesOf(fbneo.games.neogeo[6]), catalogs);
  assert.equal(full.kind, 'bios');
  assert.deepEqual(full.missing, []);
  const withoutDefault = entriesOf(fbneo.games.neogeo[6]).filter(entry => entry.name !== 'sp-s3.sp1');
  assert.deepEqual(validateBios(fbneo, 'neogeo', withoutDefault), ['sp-s3.sp1 (MVS Asia/Europe ver. 6 (1 slot))']);
});

test('an unknown zip is not treated as an arcade game', () => {
  assert.equal(identifyArcadeZip('holiday-photos.zip', [{ name: 'a.jpg', size: 10, crc: '12345678' }], catalogs), null);
});

test('placeholder files reproduce a listed size and CRC32 exactly, and the zip directory reads them back', async () => {
  const data = placeholderWithCrc(4096, '9036d879');
  assert.equal(data.length, 4096);
  assert.equal(crc32(data).toString(16).padStart(8, '0'), '9036d879');
  const zip = writeZip([{ name: 'sp-s2.sp1', data }, { name: 'sub/sm1.sm1', data: placeholderWithCrc(64, '94416d67') }]);
  const entries = await readZipDirectory(new Blob([zip]));
  assert.deepEqual(entries.map(entry => [entry.name, entry.size, entry.crc]), [['sp-s2.sp1', 4096, '9036d879'], ['sm1.sm1', 64, '94416d67']]);
});

test('the shipped catalogs match the cores RetroPlay serves', async () => {
  const fb = JSON.parse(await readFile(new URL('../data/arcade/arcade-fbneo.json', import.meta.url), 'utf8'));
  const m2p = JSON.parse(await readFile(new URL('../data/arcade/arcade-mame2003plus.json', import.meta.url), 'utf8'));
  assert.match(fb.version, /v1\.0\.0\.03.*dedd04f2/);
  assert.match(m2p.version, /3a72dae/);
  assert.equal(Object.keys(fb.games).length, 7889);
  assert.equal(Object.keys(m2p.games).length, 5257);
  for (const set of ['sf2ce', 'ssf2t', 'mslug', 'kof98', 'sfiii3', 'puckman', 'neogeo']) assert.ok(fb.games[set], set);
  assert.equal(fb.games.mslug[4], 'neogeo');
  assert.ok(!fb.games.zigzag && m2p.games.zigzag, 'zigzag exists only in MAME 2003-Plus');
  const zip = placeholderSet(fb.games.puckman[6]);
  const result = identifyArcadeZip('puckman.zip', await readZipDirectory(new Blob([zip])), { fbneo: fb, mame2003_plus: m2p });
  assert.equal(result.status, 'complete');
});

// CPS2 sets carry a 20-byte decryption key since MAME 0.178; Sega MC-8123 keys are 8 KB.
const keyed = { games: {
  xmvsf: ['X-Men Vs. Street Fighter (Europe 961004)', '1996', 'Capcom', '', '', 0, [['xvse.03f', 64, '10101010', ''], ['xvs.13m', 64, '20202020', ''], ['xmvsf.key', 20, 'd5c07311', '']]],
  gigas: ['Gigas', '1986', 'Sega', '', '', 0, [['g-7', 64, '30303030', ''], ['317-5002.key', 8192, '40404040', '']]]
} };
const keyedCatalogs = { fbneo: keyed, mame2003_plus: { games: { xmvsf: keyed.games.xmvsf } } };
const withoutKey = entriesOf(keyed.games.xmvsf[6].filter(([name]) => name !== 'xmvsf.key'));

test('an old CPS2 set without its .key is incomplete only because of the key', () => {
  const result = identifyArcadeZip('xmvsf.zip', withoutKey, keyedCatalogs);
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.missing, ['xmvsf.key']);
  assert.deepEqual(result.keys, ['xmvsf.key']);
  assert.deepEqual(result.different, []);
  assert.equal(result.cps2Key, true);
  assert.equal(onlyKeysMissing(result), true);
  assert.equal(describeArcadeStatus(result), 'FinalBurn Neo · CPS2 şifre anahtarı eksik: xmvsf.key');
});

test('a .key with other contents is reported as different, not absent', () => {
  const entries = [...withoutKey, { name: 'xmvsf.key', size: 20, crc: '01234567' }];
  const result = validateSet(keyed, 'xmvsf', entries);
  assert.deepEqual(result.different, ['xmvsf.key']);
  assert.match(describeArcadeStatus({ ...result, core: 'fbneo' }), /CPS2 şifre anahtarı farklı: xmvsf\.key/);
  assert.deepEqual(keyFindings(result.missing, entries), { absent: [], different: ['xmvsf.key'] });
  assert.deepEqual(keyFindings(result.missing, withoutKey), { absent: ['xmvsf.key'], different: [] });
});

test('a missing non-CPS2 key is a decryption key, and other missing files are not a key problem', () => {
  const sega = validateSet(keyed, 'gigas', entriesOf([keyed.games.gigas[6][0]]));
  assert.equal(sega.cps2Key, false);
  assert.match(describeArcadeStatus({ ...sega, core: 'fbneo' }), /· şifre çözme anahtarı eksik: 317-5002\.key/);
  const both = validateSet(keyed, 'xmvsf', entriesOf([keyed.games.xmvsf[6][0]]));
  assert.equal(onlyKeysMissing(both), false);
  assert.equal(missingSummary(both), '2 dosya eksik');
});

test('library records: CPS2 key lookup, truncated lists and records saved before the split', () => {
  assert.equal(isCps2KeyMissing(keyed, 'xmvsf', ['xmvsf.key']), true);
  assert.equal(isCps2KeyMissing(keyed, 'gigas', ['317-5002.key']), false);
  // Saved by the first arcade build: no "different" field, and the user's set lacked xmvsf.key.
  const oldRecord = { core: 'fbneo', set: 'xmvsf', status: 'incomplete', missing: ['xmvsf.key'], missingCount: 1 };
  assert.equal(onlyKeysMissing(oldRecord), true);
  assert.equal(missingSummary({ status: 'incomplete', missing: ['a'], missingCount: 1 }), '1 dosya eksik veya farklı');
  assert.equal(missingSummary({ status: 'incomplete', missing: ['a', 'b'], missingCount: 2, different: ['b'] }), '1 dosya eksik, 1 dosya farklı sürüm');
  // Only the first 20 names are kept; a record cut short is not "only keys".
  assert.equal(onlyKeysMissing({ status: 'incomplete', missing: ['a.key'], missingCount: 25 }), false);
});

// FB Alpha 2012 CPS2 has the CPS2 keys built in: its sets have no .key file.
test('an old CPS2 set without .key goes to FB Alpha 2012 CPS2; a current set stays on FinalBurn Neo', () => {
  const fba = { games: { xmvsf: ['X-Men vs Street Fighter (961004 Euro)', '1996', 'Capcom', '', '', 0, keyed.games.xmvsf[6].filter(([name]) => name !== 'xmvsf.key')] } };
  const three = { ...keyedCatalogs, fbalpha2012_cps2: fba };
  const old = identifyArcadeZip('xmvsf.zip', withoutKey, three);
  assert.equal(old.core, 'fbalpha2012_cps2');
  assert.equal(old.status, 'complete');
  assert.equal(describeArcadeStatus(old), 'FB Alpha 2012 CPS2 · tam set');
  assert.deepEqual(old.alternatives.map(alt => [alt.core, alt.status]), [['fbneo', 'incomplete'], ['mame2003_plus', 'incomplete']]);
  const current = identifyArcadeZip('xmvsf.zip', entriesOf(keyed.games.xmvsf[6]), three);
  assert.equal(current.core, 'fbneo');
  assert.deepEqual(current.alternatives.map(alt => [alt.core, alt.status]), [['fbalpha2012_cps2', 'complete'], ['mame2003_plus', 'complete']]);
});

test('the FB Alpha 2012 game list is read from its driver source like its ROM loader reads it', async () => {
  const { compactFbaDriverSource } = await import('../scripts/build-arcade-catalogs.mjs');
  const source = `
static struct BurnRomInfo XmvsfRomDesc[] = {
	{ "xvse.03f",      0x080000, 0xdb06413f, CPS2_PRG_68K | BRF_ESS | BRF_PRG },
	{ "xvs.13m",       0x400000, 0xf6684efd, CPS2_GFX | BRF_GRA },
	{ "opt.bin",       0x010000, 0x12345678, BRF_OPT },
	{ "89c4051.bin",   0x010000, 0x00000000, BRF_PRG | BRF_NODUMP },
};

STD_ROM_PICK(Xmvsf)
STD_ROM_FN(Xmvsf)

static struct BurnRomInfo Xmvsfr1RomDesc[] = {
	{ "xvse.03d",      0x080000, 0x5ae5bd3b, CPS2_PRG_68K | BRF_ESS | BRF_PRG },
	{ "xvs.13m",       0x400000, 0xf6684efd, CPS2_GFX | BRF_GRA },
};

STD_ROM_PICK(Xmvsfr1)
STD_ROM_FN(Xmvsfr1)

struct BurnDriver BurnDrvCpsXmvsf = {
	"xmvsf", NULL, NULL, NULL, "1996",
	"X-Men vs Street Fighter (961004 Euro)\\0", NULL, "Capcom", "CPS2",
	NULL, NULL, NULL, NULL,
	BDF_GAME_WORKING | BDF_HISCORE_SUPPORTED, 2, HARDWARE_CAPCOM_CPS2, GBF_VSFIGHT, FBF_SF,
	NULL, XmvsfRomInfo, XmvsfRomName, NULL, NULL, Cps2FightingInputInfo, NULL,
	Cps2Init, DrvExit, Cps2Frame, CpsRedraw, CpsAreaScan,
	&CpsRecalcPal, 0x1000, 384, 224, 4, 3
};

struct BurnDriver BurnDrvCpsXmvsfr1 = {
	"xmvsfr1", "xmvsf", NULL, NULL, "1996",
	"X-Men vs Street Fighter (960910 Euro)\\0", NULL, "Capcom", "CPS2",
	NULL, NULL, NULL, NULL,
	BDF_GAME_WORKING | BDF_CLONE | BDF_ORIENTATION_VERTICAL, 2, HARDWARE_CAPCOM_CPS2, GBF_VSFIGHT, FBF_SF,
	NULL, Xmvsfr1RomInfo, Xmvsfr1RomName, NULL, NULL, Cps2FightingInputInfo, NULL,
	Cps2Init, DrvExit, Cps2Frame, CpsRedraw, CpsAreaScan,
	&CpsRecalcPal, 0x1000, 224, 384, 3, 4
};
`;
  const games = compactFbaDriverSource(source);
  assert.deepEqual(games.xmvsf, ['X-Men vs Street Fighter (961004 Euro)', '1996', 'Capcom', '', '', 0, [['xvse.03f', 524288, 'db06413f', ''], ['xvs.13m', 4194304, 'f6684efd', '']]]);
  assert.deepEqual(games.xmvsfr1, ['X-Men vs Street Fighter (960910 Euro)', '1996', 'Capcom', 'xmvsf', 'xmvsf', 2, [['xvse.03d', 524288, '5ae5bd3b', ''], ['xvs.13m', 4194304, 'f6684efd', 'xvs.13m']]]);
});

test("the shipped FB Alpha 2012 CPS2 list runs the user's old X-Men Vs. Street Fighter set without a key", async () => {
  const fba = JSON.parse(await readFile(new URL('../data/arcade/arcade-fba2012-cps2.json', import.meta.url), 'utf8'));
  const fb = JSON.parse(await readFile(new URL('../data/arcade/arcade-fbneo.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(fba.games).length, 284);
  assert.ok(Object.values(fba.games).every(game => game[6].every(([name]) => !/\.key$/.test(name))), 'no key files in FB Alpha 2012 sets');
  const oldSet = fb.games.xmvsf[6].filter(([name]) => name !== 'xmvsf.key').map(([name, size, crc]) => ({ name, size, crc }));
  const result = identifyArcadeZip('xmvsf.zip', oldSet, { fbneo: fb, fbalpha2012_cps2: fba });
  assert.equal(result.core, 'fbalpha2012_cps2');
  assert.equal(result.status, 'complete');
});

test('cabinet controls and player count come from MAME 2003-Plus by set name, then parent', async () => {
  const { arcadeInputInfo } = await import('../src/arcade.js');
  const { compactDat } = await import('../scripts/build-arcade-catalogs.mjs');
  const games = compactDat(`<mame><game name="puckman"><description>Puck Man</description><rom name="a" size="4" crc="12345678"/><input players="2" control="joy4way" coins="2"/></game>
<game name="sf2" ><description>SF II</description><rom name="b" size="4" crc="22345678"/><input players="2" control="joy8way" buttons="6" coins="2"/></game>
<game name="arkanoid"><description>Arkanoid</description><rom name="c" size="4" crc="32345678"/><input players="2" control="dial" buttons="1"/></game>
<game name="tmnt"><description>TMNT</description><rom name="d" size="4" crc="42345678"/><input players="4" control="joy8way" buttons="2"/></game></mame>`);
  assert.deepEqual(games.puckman[7], [0, 4, 2]);
  assert.deepEqual(games.sf2[7], [6, 8, 2]);
  assert.deepEqual(games.arkanoid[7], [1, 0, 2]);
  assert.deepEqual(games.tmnt[7], [2, 8, 4]);
  const catalogs = { mame2003_plus: { games } };
  assert.deepEqual(arcadeInputInfo({ set: 'puckman' }, catalogs), { buttons: 0, ways: 4, players: 2 });
  assert.deepEqual(arcadeInputInfo({ set: 'sf2ce', parent: 'sf2' }, catalogs), { buttons: 6, ways: 8, players: 2 });
  assert.deepEqual(arcadeInputInfo({ set: 'tmnt' }, catalogs), { buttons: 2, ways: 8, players: 4 });
  // An older catalog entry without the player count reads as unknown (0).
  assert.deepEqual(arcadeInputInfo({ set: 'old' }, { mame2003_plus: { games: { old: ['Old', '', '', '', '', 0, [], [2, 8]] } } }), { buttons: 2, ways: 8, players: 0 });
  assert.equal(arcadeInputInfo({ set: 'unknown' }, catalogs), null);
  const shipped = JSON.parse(await readFile(new URL('../data/arcade/arcade-mame2003plus.json', import.meta.url), 'utf8'));
  assert.deepEqual(shipped.games.puckman[7], [0, 4, 2]);
  assert.deepEqual(shipped.games.dkong[7], [1, 4, 2]);
  assert.deepEqual(shipped.games['1942'][7], [2, 8, 2]);
  assert.deepEqual(shipped.games.mslug[7], [4, 8, 2]);
  assert.deepEqual(shipped.games.tmnt[7], [2, 8, 4], 'four-player cabinet');
  assert.deepEqual(shipped.games.tekken3[7], [6, 8, 2]);
});

// ---- RetroPlay's own MAME 2003-Plus build (mame2003_plus_next) for Namco System 12 ----------------
// Tekken 3: the 2025 build's "tekken3" is TET1/VER.E with older file names; in the current sources
// "tekken3" is TET2/VER.E1 and the TET1/VER.E1 program is the clone tekken3je1.
const T3_COMMON = [['rm0l', 4194304, '2886bb32'], ['rm0u', 4194304, 'c5705b92'], ['wav0', 4194304, '77ba7975']];
const stockTekken3 = ['Tekken 3 (TET1-VER.E)', '1996', 'Namco', '', '', 0, [['tet1vere.2e', 2097152, '8b01113b', ''], ['tet1vere.2j', 2097152, 'df4c96fb', ''], ...T3_COMMON.map(([n, s, c]) => [`tet1${n}.x`, s, c, ''])]];
const nextCatalog = { games: {
  tekken3: ['Tekken 3 (World, TET2/VER.E1)', '1997', 'Namco', '', '', 0, [['tet2vere1.2e', 2097152, '7ded5461', ''], ['tet2vere1.2j', 2097152, '25c96e1e', ''], ...T3_COMMON.map(([n, s, c]) => [`tet1${n}.new`, s, c, ''])]],
  tekken3je1: ['Tekken 3 (Japan, TET1/VER.E1)', '1997', 'Namco', 'tekken3', 'tekken3', 0, [['tet1vere1.2e', 2097152, '8b01113b', ''], ['tet1vere1.2j', 2097152, 'df4c96fb', ''], ...T3_COMMON.map(([n, s, c]) => [`tet1${n}.new`, s, c, `tet1${n}.new`])]]
} };
const s12Catalogs = { fbneo, mame2003_plus: { games: { ...mame.games, tekken3: stockTekken3 } }, mame2003_plus_next: nextCatalog };

test('a Namco System 12 set starts with the current MAME 2003-Plus build, found by checksums under its current name', () => {
  const result = identifyArcadeZip('tekken3.zip', entriesOf(stockTekken3[6]), s12Catalogs);
  assert.equal(result.core, 'mame2003_plus_next');
  assert.equal(result.set, 'tekken3je1');
  assert.equal(result.status, 'complete', 'every file is in the zip (file names differ; the core loads by CRC)');
  assert.equal(result.title, 'Tekken 3 (Japan, TET1/VER.E1)');
  assert.deepEqual(result.alternatives, [{ core: 'mame2003_plus', status: 'complete', set: 'tekken3' }], 'the 2025 build stays as the alternative');
  assert.match(describeArcadeStatus(result), /^MAME 2003-Plus \(2026\) · tam set · dosya adı tekken3je1\.zip olarak tanındı$/);
});

test('the current build takes a set by its own name too; games outside its list stay where they were', () => {
  const tet2 = identifyArcadeZip('tekken3.zip', entriesOf(nextCatalog.games.tekken3[6]), s12Catalogs);
  assert.deepEqual([tet2.core, tet2.set, tet2.status, tet2.renamedFrom], ['mame2003_plus_next', 'tekken3', 'complete', undefined]);
  assert.equal(identifyArcadeZip('zigzag.zip', entriesOf(mame.games.zigzag[6]), s12Catalogs).core, 'mame2003_plus');
  assert.equal(identifyArcadeZip('puckman.zip', entriesOf(fbneo.games.puckman[6]), s12Catalogs).core, 'fbneo');
  // A zip the current build cannot run (here one program ROM missing) stays with the 2025 build.
  const partial = identifyArcadeZip('tekken3.zip', entriesOf([...stockTekken3[6].slice(0, 1), ...stockTekken3[6].slice(2)]), s12Catalogs);
  assert.equal(partial.core, 'mame2003_plus');
  assert.equal(partial.status, 'incomplete');
});

test('the System 12 list is read from the driver source the core is built from', async () => {
  const { compactMameDriverSource } = await import('../scripts/build-arcade-catalogs.mjs');
  const source = `
ROM_START( tekken3 )
	ROM_REGION32_LE( 0x00400000, REGION_USER1, 0 ) /* main prg */
	ROM_LOAD16_BYTE( "tet2vere1.2e", 0x0000000, 0x200000, CRC(7ded5461) SHA1(3a5638c6ad40bfde6e12fdfd6d469f6ea5e9f4fb) )
	ROM_LOAD16_BYTE( "tet1rom0l.6",  0x0000000, 0x400000, CRC(2886bb32) SHA1(08ad9da2df25ad8c933a812ac238c81135072929) )
	ROM_LOAD( "tet1wave0.5",  0x0000000, 0x400000, CRC(77ba7975) SHA1(fe9434dcf0fb232c85efaaae1b4b13d36099620a) )
	ROM_RELOAD( 0x800000, 0x400000 )
ROM_END

ROM_START( tekken3je1 )
	ROM_LOAD16_BYTE( "tet1vere1.2e", 0x0000000, 0x200000, CRC(8b01113b) SHA1(45fdfd58293641ed16bc59c633a85a9cf64ccbaf) )
	ROM_LOAD16_BYTE( "tet1rom0l.6",  0x0000000, 0x400000, CRC(2886bb32) SHA1(08ad9da2df25ad8c933a812ac238c81135072929) )
	ROM_LOAD32_BYTE( "teg1flel.4",   0x3000000, 0x200000, NO_DUMP )
	ROM_LOAD16_BYTE( "teg1vera.2j",  0x0000001, 0x200000, BAD_DUMP CRC(97cd9524) SHA1(8031cb465db378a6d9db9b132cf1169b94cba7dc) )
ROM_END

GAMEX( 1997, tekken3,   0,        coh700s, tekken3, namcos12_h8, ROT0, "Namco",         "Tekken 3 (World, TET2/VER.E1)", GAME_IMPERFECT_GRAPHICS )
GAMEX( 1997, tekken3je1, tekken3, coh700s, tekken3, namcos12_h8, ROT90, "Namco",         "Tekken 3 (Japan, TET1/VER.E1)", GAME_IMPERFECT_GRAPHICS )
`;
  const games = compactMameDriverSource(source);
  assert.deepEqual(Object.keys(games), ['tekken3', 'tekken3je1']);
  assert.deepEqual(games.tekken3, ['Tekken 3 (World, TET2/VER.E1)', '1997', 'Namco', '', '', 0, [['tet2vere1.2e', 2097152, '7ded5461', ''], ['tet1rom0l.6', 4194304, '2886bb32', ''], ['tet1wave0.5', 4194304, '77ba7975', '']]]);
  assert.deepEqual(games.tekken3je1[6], [['tet1vere1.2e', 2097152, '8b01113b', ''], ['tet1rom0l.6', 4194304, '2886bb32', 'tet1rom0l.6'], ['teg1vera.2j', 2097152, '97cd9524', '']], 'undumped ROMs left out, bad dumps kept, parent files merged');
  assert.deepEqual([games.tekken3je1[3], games.tekken3je1[4], games.tekken3je1[5]], ['tekken3', 'tekken3', 2]);
});

test("the shipped System 12 list runs the user's Tekken 3 set (TET1/VER.E, 2025 file names) as tekken3je1", async () => {
  const next = JSON.parse(await readFile(new URL('../data/arcade/arcade-mame2003plus-next.json', import.meta.url), 'utf8'));
  const m2p = JSON.parse(await readFile(new URL('../data/arcade/arcade-mame2003plus.json', import.meta.url), 'utf8'));
  const fb = JSON.parse(await readFile(new URL('../data/arcade/arcade-fbneo.json', import.meta.url), 'utf8'));
  assert.equal(next.core, 'mame2003_plus_next');
  assert.match(next.version, /64b3c38a.*namcos12\.c/);
  assert.equal(Object.keys(next.games).length, 53);
  for (const set of ['tekken3', 'tekken3je1', 'tekken3ja', 'tektagt', 'soulclbr', 'ehrgeiz', 'kartduel']) assert.ok(next.games[set], set);
  // The set as the 2025 build lists it (the user's zip has exactly these files).
  const zip = placeholderSet(m2p.games.tekken3[6]);
  const result = identifyArcadeZip('tekken3.zip', await readZipDirectory(new Blob([zip])), { fbneo: fb, mame2003_plus: m2p, mame2003_plus_next: next });
  assert.deepEqual([result.core, result.set, result.status], ['mame2003_plus_next', 'tekken3je1', 'complete']);
});

test('the 2026 MAME 2003-Plus build needs WebAssembly SIMD; the other arcade cores do not', () => {
  assert.equal(wasmSimdSupported(), true, 'Node has WebAssembly SIMD');
  assert.equal(wasmSimdSupported({ validate: () => false }), false);
  assert.equal(wasmSimdSupported({ validate: () => { throw new Error('no'); } }), false);
  let probe = null;
  wasmSimdSupported({ validate: bytes => { probe = bytes; return true; } });
  assert.equal(WebAssembly.validate(probe), true, 'the probe is a valid SIMD module');
  assert.equal(WebAssembly.validate(probe.slice(0, -2)), false);
  assert.equal(arcadeCoreSupported('mame2003_plus_next', { simd: false }), false);
  assert.equal(arcadeCoreSupported('mame2003_plus_next', { simd: true }), true);
  for (const id of ['fbneo', 'fbalpha2012_cps2', 'mame2003_plus']) assert.equal(arcadeCoreSupported(id, { simd: false }), true, id);
});

test('starting an arcade game reads the small controls table, identical to the controls in the MAME catalog', async () => {
  const { arcadeInputInfo, loadArcadeInput, ARCADE_INPUT_URL } = await import('../src/arcade.js');
  const { inputTable } = await import('../scripts/build-arcade-catalogs.mjs');
  const shipped = JSON.parse(await readFile(new URL('../data/arcade/arcade-mame2003plus.json', import.meta.url), 'utf8'));
  const table = JSON.parse(await readFile(new URL('../public/assets/arcade-input.json', import.meta.url), 'utf8'));
  assert.deepEqual(table, inputTable(shipped.games), 'arcade-input.json is generated from the shipped catalog');
  assert.equal(Object.keys(table.games).length, Object.values(shipped.games).filter(game => Array.isArray(game[7])).length);
  assert.ok(JSON.stringify(table).length < JSON.stringify(shipped).length / 30, 'about 1/30 of the catalog');
  for (const arcade of [{ set: 'tekken3' }, { set: 'tekken3je1', parent: 'tekken3' }, { set: 'sf2ce', parent: 'sf2' }, { set: 'tmnt' }, { set: 'nosuchset' }]) {
    assert.deepEqual(arcadeInputInfo(arcade, { input: table.games }), arcadeInputInfo(arcade, { mame2003_plus: shipped }), arcade.set);
  }
  assert.deepEqual(arcadeInputInfo({ set: 'tmnt' }, { input: table.games }), { buttons: 2, ways: 8, players: 4 });
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return { ok: true, json: async () => table }; };
  const first = await loadArcadeInput(fetchImpl);
  const second = await loadArcadeInput(fetchImpl);
  assert.equal(first, second);
  assert.deepEqual(calls, [ARCADE_INPUT_URL], 'fetched once per session');
});

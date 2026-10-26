import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { identifyArcadeZip, validateSet, validateBios, biosOf, arcadeLayout, describeArcadeStatus, loadCatalog, onlyKeysMissing, isCps2KeyMissing, keyFindings, missingSummary } from '../src/arcade.js';
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

test('the catalog loader caches one request per core and retries after a failure', async () => {
  let calls = 0;
  const failing = async () => { calls++; return { ok: false, status: 503 }; };
  await assert.rejects(loadCatalog('fbneo', failing), /503/);
  const ok = async () => { calls++; return { ok: true, json: async () => ({ games: {} }) }; };
  await loadCatalog('fbneo', ok);
  await loadCatalog('fbneo', ok);
  assert.equal(calls, 2);
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
  const fb = JSON.parse(await readFile(new URL('../public/assets/arcade-fbneo.json', import.meta.url), 'utf8'));
  const m2p = JSON.parse(await readFile(new URL('../public/assets/arcade-mame2003plus.json', import.meta.url), 'utf8'));
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
  const fba = JSON.parse(await readFile(new URL('../public/assets/arcade-fba2012-cps2.json', import.meta.url), 'utf8'));
  const fb = JSON.parse(await readFile(new URL('../public/assets/arcade-fbneo.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(fba.games).length, 284);
  assert.ok(Object.values(fba.games).every(game => game[6].every(([name]) => !/\.key$/.test(name))), 'no key files in FB Alpha 2012 sets');
  const oldSet = fb.games.xmvsf[6].filter(([name]) => name !== 'xmvsf.key').map(([name, size, crc]) => ({ name, size, crc }));
  const result = identifyArcadeZip('xmvsf.zip', oldSet, { fbneo: fb, fbalpha2012_cps2: fba });
  assert.equal(result.core, 'fbalpha2012_cps2');
  assert.equal(result.status, 'complete');
});

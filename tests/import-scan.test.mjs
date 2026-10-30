import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFiles, sha256 } from '../src/lib/import-scan.ts';
import { identifyArcadeZip } from '../src/arcade.js';
import { batteryTestRom, megaDriveBinStub, unverifiedMmc3Rom } from '../e2e/fixtures/make-roms.mjs';
import { placeholderSet, writeZip } from '../e2e/fixtures/zip-writer.mjs';

const fbneo = { games: {
  neogeo: ['Neo Geo', '1990', 'SNK', '', '', 1, [['sp-s3.sp1', 64, '91b64be3', ''], ['sm1.sm1', 64, '94416d67', ''], ['sfix.sfix', 64, 'c2ea0cfd', ''], ['000-lo.lo', 64, '5a86cff2', '']]],
  mslug: ['Metal Slug', '1996', 'Nazca', '', 'neogeo', 0, [['201-p1.p1', 64, '11111111', ''], ['201-c1.c1', 64, '22222222', '']]],
  puckman: ['Puck Man (Japan, set 1)', '1980', 'Namco', '', '', 2, [['pm1.6e', 32, 'aaaaaaaa', ''], ['pm1.6f', 32, 'bbbbbbbb', '']]]
} };
const catalogs = { fbneo, mame2003_plus: { games: {} }, fbalpha2012_cps2: { games: {} } };
const ctx = (extra = {}) => ({ games: [], biosIds: new Set(), identifyArcade: async (name, entries) => identifyArcadeZip(name, entries, catalogs), ...extra });
const file = (name, bytes) => new File([bytes], name);
const nes = file('battery-test.nes', batteryTestRom());
const byName = (items, name) => items.find(item => item.fileName === name);

test('console ROMs: playable, unrecognised header, unsupported system, empty, unknown type', async () => {
  const badHeader = batteryTestRom(); badHeader[0] = 0;
  const { items } = await scanFiles([nes, file('bad.nes', badHeader), file('ge.z64', new Uint8Array(64)), file('empty.sfc', new Uint8Array(0)), file('notes.txt', 'x')], ctx());
  const ok = byName(items, 'battery-test.nes');
  assert.deepEqual([ok.kind, ok.tone, ok.platform, ok.title, ok.selected], ['rom', 'ok', 'NES', 'battery test', true]);
  assert.match(ok.headline, /^NES · Oynatılabilir dosya$/);
  assert.match(ok.crc32, /^[0-9A-F]{8}$/);
  assert.match(ok.meta, /^CRC32 [0-9A-F]{8} · 40 KB$/);
  assert.equal(ok.hash, await sha256(nes));
  assert.deepEqual([byName(items, 'bad.nes').tone, byName(items, 'bad.nes').selectable], ['skip', false]);
  assert.match(byName(items, 'bad.nes').skipReason, /NES doğrulaması başarısız/);
  assert.match(byName(items, 'ge.z64').headline, /Nintendo 64 henüz desteklenmiyor · eklenmeyecek/);
  assert.match(byName(items, 'empty.sfc').skipReason, /dosya boş/);
  assert.match(byName(items, 'notes.txt').headline, /Tanınmayan dosya türü/);
});

test('a Mega Drive .bin is recognised by its SEGA header, other .bin files are not guessed', async () => {
  const { items } = await scanFiles([file('sonic2.bin', megaDriveBinStub()), file('mystery.bin', new Uint8Array(1024))], ctx());
  assert.deepEqual([byName(items, 'sonic2.bin').platform, byName(items, 'sonic2.bin').tone], ['MD', 'ok']);
  assert.match(byName(items, 'sonic2.bin').meta, /sonic2\.bin · içerikten tanındı/);
  assert.match(byName(items, 'mystery.bin').headline, /Sistem tanınmadı/);
});

test('duplicates: twice in one choice, already in the library, or a restored record that gets its ROM back', async () => {
  const hash = await sha256(nes);
  let { items } = await scanFiles([nes, file('copy.nes', batteryTestRom())], ctx());
  assert.equal(items.filter(item => item.selectable).length, 1);
  assert.match(byName(items, 'copy.nes').headline, /iki kez/);
  ({ items } = await scanFiles([nes], ctx({ games: [{ id: 'x', title: 'Old', platform: 'NES', contentHash: hash, blob: new Blob([batteryTestRom()]) }] })));
  assert.match(items[0].headline, /Zaten kütüphanede/);
  assert.equal(items[0].selectable, false);
  ({ items } = await scanFiles([nes], ctx({ games: [{ id: 'x', title: 'Restored', platform: 'NES', contentHash: hash, restoredMetadataOnly: true }] })));
  assert.equal(items[0].relink.id, 'x');
  assert.match(items[0].headline, /Yedek kaydına bağlanacak/);
});

test('an unknown Super Mario Bros. 3 dump is flagged, not refused', async () => {
  const { items } = await scanFiles([file('Super Mario Bros. 3 [h2].nes', unverifiedMmc3Rom())], ctx());
  assert.deepEqual([items[0].tone, items[0].selected, items[0].title], ['warn', true, 'Super Mario Bros. 3 [h2]']);
  assert.match(items[0].headline, /Tanınmayan döküm/);
});

test('zips: console ROMs come out, arcade sets and BIOS stay zipped and are checked', async () => {
  const romZip = file('games.zip', writeZip([{ name: 'inner/battery-test.nes', data: batteryTestRom() }, { name: 'readme.txt', data: new TextEncoder().encode('hi') }]));
  const arcade = file('puckman.zip', placeholderSet(fbneo.games.puckman[6]));
  const neo = file('mslug.zip', placeholderSet(fbneo.games.mslug[6]));
  const bios = file('neogeo.zip', placeholderSet(fbneo.games.neogeo[6]));
  const junk = file('photos.zip', writeZip([{ name: 'a.jpg', data: new Uint8Array(10) }]));
  const { items, log } = await scanFiles([romZip, arcade, neo, bios, junk], ctx());
  const inner = byName(items, 'battery-test.nes');
  assert.equal(inner.fromZip, 'games.zip');
  assert.match(inner.meta, /games\.zip içinden/);
  assert.deepEqual(log, ['ZIP açıldı: games.zip — 1 desteklenen ROM bulundu']);
  const pm = byName(items, 'puckman.zip');
  assert.deepEqual([pm.kind, pm.tone, pm.title, pm.platform], ['arcade', 'ok', 'Puck Man (Japan, set 1)', 'ARCADE']);
  assert.match(pm.headline, /Arcade · FinalBurn Neo · tam set/);
  const ms = byName(items, 'mslug.zip');
  assert.equal(ms.tone, 'warn', 'needs a BIOS that is not installed yet');
  assert.match(ms.headline, /neogeo\.zip BIOS gerekli/);
  const b = byName(items, 'neogeo.zip');
  assert.deepEqual([b.kind, b.bios.set, b.bios.missing], ['bios', 'neogeo', []]);
  assert.match(byName(items, 'photos.zip').headline, /ZIP içinde desteklenen oyun yok/);
  const installed = await scanFiles([neo], ctx({ biosIds: new Set(['neogeo.zip']) }));
  assert.equal(installed.items[0].tone, 'ok');
});

test('a folder scan only looks at game files and counts the rest', async () => {
  const { items, ignored } = await scanFiles([nes, file('cover.jpg', new Uint8Array(4)), file('info.txt', 'x'), file('game.sfc', new Uint8Array(1024))], ctx(), { folder: true });
  assert.deepEqual(items.map(item => item.fileName), ['battery-test.nes', 'game.sfc']);
  assert.equal(ignored, 2);
  const progress = [];
  await scanFiles([nes, nes], ctx(), { onProgress: (done, total) => progress.push(`${done}/${total}`) });
  assert.deepEqual(progress, ['1/2', '2/2']);
});

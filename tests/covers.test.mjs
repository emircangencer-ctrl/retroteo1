import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { coverCandidates, coverSets, coverUrl, findCover, findCoverByChecksum, looseKey, matchCover, romChecksums, thumbnailName, COVER_BASE } from '../src/lib/covers.ts';
import { coverIndex, crcTable, datChecksums } from '../scripts/build-cover-index.mjs';
import { crc32 } from '../src/nes-rom.js';

const list = key => JSON.parse(fs.readFileSync(new URL(`../public/assets/covers/${key}.json`, import.meta.url), 'utf8'));
const lists = Object.fromEntries(['nes', 'snes', 'md', 'mame', 'fbneo'].map(key => [key, list(key)]));
const stem = (index, names) => { const m = findCover(index, names); return m && `${m.type}:${m.stem}`; };
const hex = n => n.toString(16).toUpperCase().padStart(8, '0');

test('the lists ship with every system that has covers, pinned to a commit', () => {
  for (const [key, index] of Object.entries(lists)) {
    assert.match(index.ref, /^[0-9a-f]{40}$/, key);
    assert.ok(index.boxarts.length > 2000 && index.titles.length > 2000, key);
    assert.ok(index.boxarts.every(s => !s.includes('[')), `${key}: no GoodTools marks`);
  }
  for (const key of ['nes', 'snes', 'md']) assert.ok(Object.keys(lists[key].crc).length > 1500, `${key} checksums`);
});

test('consoles are recognised by ROM checksum, whatever the file is called', () => {
  // No-Intro: Super Mario Bros. (World), cartridge data without the iNES header.
  const match = findCoverByChecksum(lists.nes, ['D445F698']);
  assert.equal(match?.stem, 'Super Mario Bros. (World)');
  assert.equal(match?.type, 'boxarts');
  assert.equal(match?.by, 'checksum');
  assert.equal(findCoverByChecksum(lists.nes, ['00000000']), null);
});

test('ROM checksums skip the headers No-Intro does not list', () => {
  const data = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7) & 0xff);
  const ines = new Uint8Array(16 + data.length);
  ines.set([0x4e, 0x45, 0x53, 0x1a, 2, 1]); ines.set(data, 16);
  assert.deepEqual(romChecksums('NES', ines), [hex(crc32(data)), hex(crc32(ines))]);
  assert.deepEqual(romChecksums('NES', data), [hex(crc32(data))]);
  const snes = Uint8Array.from({ length: 1024 * 4 }, (_, i) => i & 0xff);
  const copier = new Uint8Array(512 + snes.length); copier.set(snes, 512);
  assert.equal(romChecksums('SNES', copier)[0], hex(crc32(snes)));
  assert.deepEqual(romChecksums('SNES', snes), [hex(crc32(snes))]);
  assert.deepEqual(romChecksums('MD', snes), [hex(crc32(snes))]);
  assert.deepEqual(romChecksums('MD', new Uint8Array()), []);
});

test('by name: exact, same letters, then another version of the same game', () => {
  assert.equal(stem(lists.nes, ['Super Mario Bros. (World)']), 'boxarts:Super Mario Bros. (World)');
  assert.equal(stem(lists.nes, ['Super Mario Bros 3']), 'boxarts:Super Mario Bros. 3 (USA)');
  assert.equal(stem(lists.nes, ['The Legend of Zelda']), 'boxarts:Legend of Zelda, The (USA)', 'article moved to the end');
  assert.equal(stem(lists.snes, ['The Legend of Zelda - A Link to the Past']), 'boxarts:Legend of Zelda, The - A Link to the Past (USA)');
  assert.equal(stem(lists.snes, ['Donkey Kong Country (Europe) (Rev 2)']), 'boxarts:Donkey Kong Country (USA) (Rev 2)', 'closest tags win');
  assert.equal(stem(lists.md, ['Sonic the Hedgehog']), 'boxarts:Sonic The Hedgehog (USA)');
  assert.equal(stem(lists.mame, ['PuckMan (Japan set 1)']), 'boxarts:PuckMan (Japan set 1)');
  assert.equal(stem(lists.mame, ['Street Fighter II: The World Warrior (World 910522)']), 'boxarts:Street Fighter II_ The World Warrior (World 910522)', 'file-name characters');
  assert.equal(stem(lists.mame, ['Tekken 3 (Japan, TET1/VER.A)'])?.startsWith('boxarts:Tekken 3 ('), true);
  assert.equal(stem(lists.nes, ['smb3']), null, 'no guessing from abbreviations');
  assert.equal(stem(lists.nes, ['zzz not a game']), null);
});

test('a clean release is preferred over hacks, prototypes and pirate copies', () => {
  const index = { repo: 'r', boxarts: ['Game (USA) (Proto)', 'Game (Asia) (Pirate)', 'Game (Europe)', 'Game (Japan)'], titles: [], links: {} };
  assert.equal(findCover(index, ['Game'])?.stem, 'Game (Europe)');
  assert.equal(findCover(index, ['Game (Japan)'])?.stem, 'Game (Japan)');
  assert.equal(findCover(index, ['Game (USA) (Proto)'])?.stem, 'Game (USA) (Proto)', 'asked for by name');
  const titlesOnly = { repo: 'r', boxarts: [], titles: ['Only Title (USA)'], links: {} };
  assert.equal(findCover(titlesOnly, ['Only Title'])?.type, 'titles', 'title screen when there is no box art');
});

test('picture addresses: pinned commit, encoded names, links resolved', () => {
  const snes = lists.snes;
  const url = coverUrl(snes, 'boxarts', 'ActRaiser (Germany)');
  assert.equal(url, `${COVER_BASE}/${snes.repo}/${snes.ref}/Named_Boxarts/${encodeURIComponent('ActRaiser (Europe)')}.png`);
  assert.equal(coverUrl({ repo: 'R', boxarts: [], titles: [], links: {} }, 'titles', 'A & B'), `${COVER_BASE}/R/master/Named_Titles/A%20%26%20B.png`);
  assert.equal(thumbnailName('Q*bert: "Arcade" <1/2>?'), 'Q_bert_ _Arcade_ _1_2__');
  assert.equal(looseKey('PuckMan (Japan, set 1)'), looseKey('Puck Man (Japan set 1)'));
});

test('which lists and names a game is looked up under', () => {
  assert.deepEqual(coverSets({ platform: 'NES' }), ['nes']);
  assert.deepEqual(coverSets({ platform: 'ARCADE', arcade: { core: 'fbneo' } }), ['fbneo', 'mame']);
  assert.deepEqual(coverSets({ platform: 'ARCADE', arcade: { core: 'mame2003_plus_next' } }), ['mame', 'fbneo']);
  assert.deepEqual(coverSets({ platform: 'GB' }), []);
  assert.deepEqual(coverCandidates({ platform: 'NES', fileName: 'Contra (USA).nes', title: 'Contra' }), ['Contra (USA)', 'Contra']);
  assert.deepEqual(coverCandidates({ platform: 'ARCADE', fileName: 'sf2.zip', title: 'Street Fighter II' }), ['Street Fighter II']);
});

test('matchCover: checksum first, then names, loading each list once', async () => {
  const requests = [];
  const fetchImpl = async url => { requests.push(url); return new Response(JSON.stringify(lists[url.split('/').pop().replace('.json', '')])); };
  const byCrc = await matchCover({ id: 'a', platform: 'NES', title: 'whatever', fileName: 'x.nes' }, { checksums: ['D445F698'], fetchImpl });
  assert.equal(byCrc?.stem, 'Super Mario Bros. (World)');
  const byName = await matchCover({ id: 'b', platform: 'NES', title: 'Contra', fileName: 'Contra (USA).nes' }, { checksums: ['00000000'], fetchImpl });
  assert.equal(byName?.stem, 'Contra (USA)');
  assert.equal(byName?.by, 'name');
  assert.deepEqual(requests, ['/assets/covers/nes.json']);
});

test('the list builder: names from the repository tree, checksums from No-Intro', () => {
  const index = coverIndex('Repo', [
    { mode: '100644', file: 'Named_Boxarts/Alpha (USA).png' },
    { mode: '120000', file: 'Named_Boxarts/Alpha (Europe).png' },
    { mode: '100644', file: 'Named_Boxarts/Beta (Japan) [T-En].png' },
    { mode: '100644', file: 'Named_Titles/Gamma (Japan).png' },
    { mode: '100644', file: 'Named_Snaps/Alpha (USA).png' }
  ], new Map([['Named_Boxarts/Alpha (Europe).png', 'Alpha (USA).png']]));
  assert.deepEqual(index, { repo: 'Repo', boxarts: ['Alpha (Europe)', 'Alpha (USA)'], titles: ['Gamma (Japan)'], links: { 'b:Alpha (Europe)': 'Alpha (USA)' } });
  const dat = [
    'clrmamepro (\n\tname "x"\n)\n',
    'game (\n\tname "Alpha (USA)"\n\trom ( name "Alpha (USA).nes" size 32 crc 11111111 md5 0 )\n)\n',
    'game (\n\tname "Alpha (USA)"\n\trom ( name "Alpha (USA).unh" size 16 crc 22222222 md5 0 )\n)\n',
    'game (\n\tname "Gamma (Japan)"\n\tregion "Japan"\n\trom ( name "Gamma (Japan).nes" size 32 crc 33333333 md5 0 )\n)\n',
    'game (\n\tname "Delta (USA)"\n\trom ( name "Delta (USA).unh" size 16 crc 44444444 md5 0 )\n)\n'
  ].join('');
  const games = datChecksums(dat, { headerless: true });
  assert.deepEqual(games, [{ name: 'Alpha (USA)', crcs: ['22222222'] }, { name: 'Gamma (Japan)', crcs: ['33333333'] }, { name: 'Delta (USA)', crcs: ['44444444'] }]);
  assert.deepEqual(crcTable(index, games), { 22222222: 1, 33333333: -1 }, 'Delta has no picture and is left out');
});

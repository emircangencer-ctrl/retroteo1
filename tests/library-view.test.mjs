import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGames, sortGames, systemCounts, recentlyPlayed, continueCandidate, isPlayable, cardStatus, cardMeta, normalizeSort } from '../src/lib/library-view.ts';

const rom = () => new Blob([new Uint8Array(16)]);
const games = [
  { id: 'a', title: 'Super Mario Bros. 3', platform: 'NES', fileName: 'smb3.nes', blob: rom(), addedAt: 1, lastPlayed: 50, favorite: true, year: 1988 },
  { id: 'b', title: 'Sonic the Hedgehog 2', platform: 'MD', fileName: 'sonic2.bin', blob: rom(), addedAt: 3 },
  { id: 'c', title: 'Super Metroid', platform: 'SNES', fileName: 'sm.sfc', blob: rom(), addedAt: 2, lastPlayed: 90 },
  { id: 'd', title: 'İstanbul Racer', platform: 'NES', fileName: 'ist.nes', restoredMetadataOnly: true, addedAt: 4 },
  { id: 'e', title: 'GoldenEye 007', platform: 'N64', fileName: 'ge.z64', blob: rom(), addedAt: 5 },
  { id: 'f', title: 'Metal Slug', platform: 'ARCADE', fileName: 'mslug.zip', blob: rom(), addedAt: 6, arcade: { core: 'fbneo', set: 'mslug', status: 'complete', missing: [], bios: 'neogeo', manufacturer: 'Nazca' } }
];

test('search matches title, system and file name word by word, Turkish-aware', () => {
  assert.deepEqual(filterGames(games, { query: 'super' }).map(g => g.id), ['a', 'c']);
  assert.deepEqual(filterGames(games, { query: 'mega drive' }).map(g => g.id), ['b']);
  assert.deepEqual(filterGames(games, { query: 'sonic2.bin' }).map(g => g.id), ['b']);
  assert.deepEqual(filterGames(games, { query: 'istanbul' }).map(g => g.id), ['d'], 'tr-TR folding: İ → i');
  assert.deepEqual(filterGames(games, { query: 'İSTANBUL RACER' }).map(g => g.id), ['d']);
  assert.deepEqual(filterGames(games, { query: 'mslug' }).map(g => g.id), ['f'], 'arcade set names are searchable');
  assert.deepEqual(filterGames(games, { system: 'NES' }).map(g => g.id), ['a', 'd']);
  assert.deepEqual(filterGames(games, { favorites: true }).map(g => g.id), ['a']);
  assert.deepEqual(filterGames(games, { withSaves: true, saveIds: new Set(['c']) }).map(g => g.id), ['c']);
});

test('sorting: recent puts played games first, then newest additions', () => {
  assert.deepEqual(sortGames(games, 'recent').map(g => g.id), ['c', 'a', 'f', 'e', 'd', 'b']);
  assert.deepEqual(sortGames(games, 'added').map(g => g.id), ['f', 'e', 'd', 'b', 'c', 'a']);
  assert.deepEqual(sortGames(games, 'name').map(g => g.title)[0], 'GoldenEye 007');
  assert.deepEqual(sortGames(games, 'system').map(g => g.platform), ['NES', 'NES', 'SNES', 'MD', 'ARCADE', 'N64']);
  assert.equal(normalizeSort('nope'), 'recent');
  assert.notEqual(sortGames(games, 'name'), games, 'the library list itself is not reordered');
});

test('system counts, recent games and the game to continue', () => {
  assert.deepEqual(systemCounts(games), [{ key: 'NES', count: 2 }, { key: 'SNES', count: 1 }, { key: 'MD', count: 1 }, { key: 'ARCADE', count: 1 }, { key: 'N64', count: 1 }]);
  assert.deepEqual(recentlyPlayed(games).map(g => g.id), ['c', 'a']);
  assert.equal(continueCandidate(games).id, 'c');
  assert.equal(continueCandidate([{ ...games[3], lastPlayed: 99 }]), null, 'a record without its ROM is not offered');
});

test('playable records and card texts', () => {
  assert.equal(isPlayable(games[0]), true);
  assert.equal(isPlayable(games[3]), false);
  assert.equal(isPlayable(games[4]), false);
  const ctx = { biosIds: new Set(), games };
  assert.deepEqual(cardStatus(games[1], ctx), { text: 'Mega Drive · Oynatılabilir dosya', tone: 'ok' });
  assert.deepEqual(cardStatus(games[3], ctx), { text: 'Yedek kaydı · ROM yok', tone: 'warn' });
  assert.deepEqual(cardStatus(games[4], ctx), { text: 'N64 henüz desteklenmiyor', tone: 'muted' });
  assert.deepEqual(cardStatus(games[5], ctx), { text: 'neogeo.zip gerekli', tone: 'warn' });
  assert.deepEqual(cardStatus(games[5], { ...ctx, biosIds: new Set(['neogeo.zip']) }), { text: 'FinalBurn Neo · tam set', tone: 'ok' });
  assert.equal(cardMeta(games[0], ctx), '1988');
  assert.equal(cardMeta(games[5], { ...ctx, biosIds: new Set(['neogeo.zip']) }), 'Nazca');
  assert.equal(cardMeta(games[3], ctx), 'Yedek kaydı · ROM yok');
});

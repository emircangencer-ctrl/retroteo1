import test from 'node:test';
import assert from 'node:assert/strict';
import { safeCoverColor, validBackup } from '../src/library-backup.js';

const validGame = () => ({
  id: 'rom-123',
  title: 'Mario',
  platform: 'NES',
  fileName: 'Mario.nes',
  size: 16384,
  year: null,
  genre: 'Bilinmiyor',
  symbol: 'NES',
  coverBg: '#284e78',
  coverGlow: '#3b9bca',
  sizeLabel: '16 KB',
  contentHash: 'a'.repeat(64),
  addedAt: 1760000000000,
  favorite: false,
  status: 'imported',
  romValidation: { valid: true }
});
const backup = game => ({ app: 'RetroPlay', backupType: 'library-metadata', schemaVersion: 1, games: [game] });

test('accepts a valid library backup produced by the app', () => {
  assert.equal(validBackup(backup(validGame())), true);
});

test('rejects CSS declaration injection through imported cover colors', () => {
  const game = validGame();
  game.coverBg = '#123456; background-image:url(https://attacker.example/track)';
  assert.equal(validBackup(backup(game)), false);
});

test('rejects incorrect metadata types and oversized strings', () => {
  const wrongType = validGame();
  wrongType.favorite = 'yes';
  assert.equal(validBackup(backup(wrongType)), false);

  const oversizedTitle = validGame();
  oversizedTitle.title = 'x'.repeat(301);
  assert.equal(validBackup(backup(oversizedTitle)), false);
});

test('rejects control characters in identifiers and titles', () => {
  const game = validGame();
  game.title = 'Mario\nInjected';
  assert.equal(validBackup(backup(game)), false);
});

test('accepts optional metadata fields being absent', () => {
  const game = { id: 'rom-456', title: 'Homebrew', platform: 'NES', fileName: 'homebrew.nes', size: 16 };
  assert.equal(validBackup(backup(game)), true);
});

test('rejects backups with too many library records', () => {
  const games = Array.from({ length: 10001 }, validGame);
  assert.equal(validBackup({ app: 'RetroPlay', backupType: 'library-metadata', schemaVersion: 1, games }), false);
});

test('rejects duplicate game IDs that would overwrite each other during restore', () => {
  const first = validGame();
  const duplicate = { ...validGame(), title: 'Different title' };
  assert.equal(validBackup({ app: 'RetroPlay', backupType: 'library-metadata', schemaVersion: 1, games: [first, duplicate] }), false);
});

test('sanitizes malicious legacy cover colors when rendered', () => {
  assert.equal(safeCoverColor('#12aBcF', '#000000'), '#12aBcF');
  assert.equal(safeCoverColor('#123456; background-image:url(https://attacker.example)', '#284e78'), '#284e78');
  assert.equal(safeCoverColor('url(https://attacker.example)', '#3b9bca'), '#3b9bca');
  assert.equal(safeCoverColor(null, '#284e78'), '#284e78');
});

test('rejects IDs reserved for built-in demo cards', () => {
  const game = { ...validGame(), id: 'demo-mario' };
  assert.equal(validBackup(backup(game)), false);
});

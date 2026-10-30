import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyImport } from '../src/import-match.js';

const HASH = 'a'.repeat(64);

test('new content is imported as a new record', () => {
  assert.deepEqual(classifyImport([], HASH), { action: 'new' });
  assert.deepEqual(classifyImport([{ id: 'x', contentHash: 'b'.repeat(64), blob: new Blob([new Uint8Array(1)]) }], HASH), { action: 'new' });
  assert.deepEqual(classifyImport([{ id: 'x' }], null), { action: 'new' });
});

test('the same playable content is a duplicate', () => {
  const game = { id: 'rom-1', contentHash: HASH, blob: new Blob([new Uint8Array(4)]) };
  assert.deepEqual(classifyImport([game], HASH), { action: 'duplicate', game });
});

test('a metadata-only record restored from a backup is relinked instead of blocking the ROM', () => {
  const restored = { id: 'rom-1', contentHash: HASH, restoredMetadataOnly: true, favorite: true };
  assert.deepEqual(classifyImport([restored], HASH), { action: 'relink', game: restored });
  const missingBlob = { id: 'rom-2', contentHash: HASH };
  assert.deepEqual(classifyImport([missingBlob], HASH), { action: 'relink', game: missingBlob });
});

test('demo cards never match imported content', () => {
  assert.deepEqual(classifyImport([{ id: 'demo-x', demo: true, contentHash: HASH }], HASH), { action: 'new' });
});

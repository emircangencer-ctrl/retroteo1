import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatterySaveRecord, emulatorGameId } from '../src/save-data.js';

test('EmulatorJS game ID is stable for the same platform and ROM identity', () => {
  const first = { id: 'rom-one', platform: 'SNES', contentHash: 'abc123' };
  const reimported = { id: 'rom-two', platform: 'SNES', contentHash: 'abc123' };
  assert.equal(emulatorGameId(first), emulatorGameId(reimported));
  assert.notEqual(emulatorGameId(first), emulatorGameId({ ...first, platform: 'MD' }));
  assert.ok(emulatorGameId(first) > 0);
  assert.ok(emulatorGameId(first) <= 0x7fffffff);
});

test('battery save record copies bytes and records per-game metadata', () => {
  const game = {
    id: 'rom-one',
    platform: 'NES',
    contentHash: 'hash-of-rom'
  };
  const input = new Uint8Array([1, 3, 5, 7]);
  const record = createBatterySaveRecord(game, {
    bytes: input,
    hash: 'save-hash',
    updatedAt: 123456,
    systemId: 'nes'
  });

  input[0] = 99;
  assert.equal(record.id, 'rom-one');
  assert.equal(record.platform, 'NES');
  assert.equal(record.systemId, 'nes');
  assert.equal(record.contentHash, 'hash-of-rom');
  assert.equal(record.saveHash, 'save-hash');
  assert.equal(record.gameId, emulatorGameId(game));
  assert.equal(record.byteLength, 4);
  assert.equal(record.updatedAt, 123456);
  assert.deepEqual([...record.bytes], [1, 3, 5, 7]);
});

test('empty or missing battery save buffers are ignored', () => {
  const game = { id: 'rom-one', platform: 'NES' };
  assert.equal(createBatterySaveRecord(game, { bytes: new Uint8Array(0) }), null);
  assert.equal(createBatterySaveRecord(game, {}), null);
});

test('battery save records accept ArrayBuffer views without persisting adjacent bytes', () => {
  const source = new Uint8Array([10, 20, 30, 40, 50]);
  const record = createBatterySaveRecord(
    { id: 'rom-md', platform: 'MD' },
    { bytes: source.subarray(1, 4), systemId: 'segaMD' }
  );
  assert.deepEqual([...record.bytes], [20, 30, 40]);
  assert.equal(record.byteLength, 3);
  assert.equal(record.systemId, 'segaMD');
});

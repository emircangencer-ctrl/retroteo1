import test from 'node:test';
import assert from 'node:assert/strict';
import { sameBytes, decideSaveRestore, createSaveCapture } from '../src/save-sync.js';

test('byte comparison is exact and length-sensitive', () => {
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0])), false);
  assert.equal(sameBytes(null, new Uint8Array([1])), false);
});

test('start-up restore prefers the app copy and never discards an emulator-only save', () => {
  const a = new Uint8Array([1, 2, 3]);
  assert.equal(decideSaveRestore({ appBytes: a, coreBytes: new Uint8Array([9]) }), 'restore-app');
  assert.equal(decideSaveRestore({ appBytes: a, coreBytes: null }), 'restore-app');
  assert.equal(decideSaveRestore({ appBytes: a, coreBytes: new Uint8Array([1, 2, 3]) }), 'in-sync');
  assert.equal(decideSaveRestore({ appBytes: null, coreBytes: a }), 'adopt-core');
  assert.equal(decideSaveRestore({ appBytes: new Uint8Array(0), coreBytes: a }), 'adopt-core');
  assert.equal(decideSaveRestore({}), 'none');
});

test('capture persists only changed SRAM and keeps writes in order', async () => {
  let live = new Uint8Array([0, 0]);
  const writes = [];
  const capture = createSaveCapture({
    read: () => live,
    persist: async (bytes, reason) => { await new Promise(resolve => setTimeout(resolve, 5)); writes.push([reason, [...bytes]]); }
  });
  capture.prime(new Uint8Array([0, 0]));
  assert.equal((await capture.capture('interval')).status, 'unchanged');
  live = new Uint8Array([1, 0]);
  const first = capture.capture('pause');
  live = new Uint8Array([2, 0]);
  const second = capture.capture('close');
  assert.equal((await first).status, 'saved');
  assert.equal((await second).status, 'saved');
  assert.deepEqual(writes, [['pause', [1, 0]], ['close', [2, 0]]]);
  assert.equal((await capture.capture('interval')).status, 'unchanged');
});

test('a snapshot is taken synchronously so the emulator can be torn down right after capture', async () => {
  const live = new Uint8Array([5, 5]);
  let persisted = null;
  const capture = createSaveCapture({ read: () => live, persist: async bytes => { persisted = bytes; } });
  const pending = capture.capture('close');
  live[0] = 0; // the core's memory goes away / changes after teardown
  await pending;
  assert.deepEqual([...persisted], [5, 5]);
});

test('a failed write is retried on the next capture and empty reads are ignored', async () => {
  let fail = true;
  let calls = 0;
  const capture = createSaveCapture({
    read: () => new Uint8Array([3]),
    persist: async () => { calls++; if (fail) throw new Error('quota'); }
  });
  const failed = await capture.capture('interval');
  assert.equal(failed.status, 'failed');
  fail = false;
  assert.equal((await capture.capture('interval')).status, 'saved');
  assert.equal(calls, 2);

  const empty = createSaveCapture({ read: () => null, persist: async () => assert.fail('nothing to persist') });
  assert.equal((await empty.capture('close')).status, 'empty');
  const throwing = createSaveCapture({ read: () => { throw new Error('gone'); }, persist: async () => assert.fail('nothing to persist') });
  assert.equal((await throwing.capture('close')).status, 'empty');
});

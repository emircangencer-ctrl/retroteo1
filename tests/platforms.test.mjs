import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM, platformInfo } from '../src/platforms.js';

test('resolves registered platform definitions', () => {
  assert.equal(platformInfo('NES'), PLATFORM.NES);
  assert.equal(platformInfo('SNES').short, 'SNES');
});

test('treats inherited object keys as unknown platform strings', () => {
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const info = platformInfo(key);
    assert.equal(info.label, 'Bilinmeyen sistem');
    assert.equal(info.short, key);
    assert.equal(info.logo, '?');
    assert.equal(typeof info.short.toUpperCase, 'function');
  }
});

test('handles missing and non-string platform keys safely', () => {
  assert.equal(platformInfo(null).short, 'Bilinmiyor');
  assert.equal(platformInfo('').short, 'Bilinmiyor');
  assert.equal(platformInfo({}).short, 'Bilinmiyor');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM, platformInfo } from '../src/platforms.js';

test('resolves all registered library platforms', () => {
  assert.equal(platformInfo('NES'), PLATFORM.NES);
  assert.equal(platformInfo('SNES').short, 'SNES');
  assert.equal(platformInfo('MD').short, 'Mega Drive');
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

test('bounds and sanitizes unknown platform labels from legacy records', () => {
  assert.equal(platformInfo('x'.repeat(1000)).short.length, 32);
  assert.equal(platformInfo('bad\nlabel').short, 'badlabel');
  assert.equal(platformInfo(null).short, 'Bilinmiyor');
  assert.equal(platformInfo({}).short, 'Bilinmiyor');
});

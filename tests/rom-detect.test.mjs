import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRomPlatform, isMegaDriveHeader, fileExtension } from '../src/rom-detect.js';

function megaDriveHeader(text) {
  const bytes = new Uint8Array(0x200);
  for (let i = 0; i < text.length; i++) bytes[0x100 + i] = text.charCodeAt(i);
  return bytes;
}

test('extensions resolve to their registered platform', () => {
  assert.equal(detectRomPlatform('Game.nes'), 'NES');
  assert.equal(detectRomPlatform('Game.SFC'), 'SNES');
  assert.equal(detectRomPlatform('Game.smc'), 'SNES');
  assert.equal(detectRomPlatform('Game.md'), 'MD');
  assert.equal(detectRomPlatform('Game.gen'), 'MD');
  assert.equal(detectRomPlatform('Game.z64'), 'N64');
  assert.equal(detectRomPlatform('README'), 'UNKNOWN');
  assert.equal(fileExtension('a.b.NES'), 'nes');
});

test('.bin is Mega Drive only when the SEGA system header is present', () => {
  assert.equal(isMegaDriveHeader(megaDriveHeader('SEGA MEGA DRIVE ')), true);
  assert.equal(isMegaDriveHeader(megaDriveHeader('SEGA GENESIS    ')), true);
  assert.equal(isMegaDriveHeader(megaDriveHeader(' SEGA MEGA DRIVE')), true);
  assert.equal(detectRomPlatform('sonic2.bin', megaDriveHeader('SEGA GENESIS    ')), 'MD');
  assert.equal(detectRomPlatform('disc.bin', new Uint8Array(0x200)), 'UNKNOWN');
  assert.equal(detectRomPlatform('short.bin', new Uint8Array(16)), 'UNKNOWN');
  assert.equal(detectRomPlatform('nothing.bin'), 'UNKNOWN');
});

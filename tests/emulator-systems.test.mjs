import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMULATED_SYSTEMS,
  getEmulatedSystem,
  isPlayablePlatform,
  supportsRomExtension
} from '../src/emulator-systems.js';

test('NES, SNES and Mega Drive map to documented EmulatorJS system IDs', () => {
  assert.equal(EMULATED_SYSTEMS.NES.emulatorJsSystemId, 'nes');
  assert.equal(EMULATED_SYSTEMS.SNES.emulatorJsSystemId, 'snes');
  assert.equal(EMULATED_SYSTEMS.MD.emulatorJsSystemId, 'segaMD');
});

test('only systems wired into the player registry are advertised as playable', () => {
  assert.equal(isPlayablePlatform('NES'), true);
  assert.equal(isPlayablePlatform('SNES'), true);
  assert.equal(isPlayablePlatform('MD'), true);
  assert.equal(isPlayablePlatform('N64'), false);
  assert.equal(isPlayablePlatform('CPS1'), false);
  assert.equal(getEmulatedSystem('UNKNOWN'), null);
});

test('supported ROM extensions are checked per system and case-insensitively', () => {
  assert.equal(supportsRomExtension('NES', 'nes'), true);
  assert.equal(supportsRomExtension('SNES', 'SFC'), true);
  assert.equal(supportsRomExtension('SNES', 'smc'), true);
  assert.equal(supportsRomExtension('MD', 'GEN'), true);
  assert.equal(supportsRomExtension('MD', 'bin'), false);
  assert.equal(supportsRomExtension('N64', 'z64'), false);
});

test('touch layouts expose two buttons for NES and expanded buttons for SNES and Mega Drive', () => {
  assert.deepEqual(EMULATED_SYSTEMS.NES.actionButtons.map(button => button.label), ['B', 'A']);
  assert.equal(EMULATED_SYSTEMS.SNES.actionButtons.length, 6);
  assert.deepEqual(EMULATED_SYSTEMS.MD.actionButtons.map(button => button.label), ['Y', 'X', 'Z', 'B', 'C', 'A']);
});

test('prototype-inherited names never resolve to playable emulator systems', () => {
  for (const platform of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(getEmulatedSystem(platform), null);
    assert.equal(isPlayablePlatform(platform), false);
    assert.equal(supportsRomExtension(platform, 'nes'), false);
  }
  assert.equal(getEmulatedSystem({}), null);
  assert.equal(isPlayablePlatform({}), false);
});

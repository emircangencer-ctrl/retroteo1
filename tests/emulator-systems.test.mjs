import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMULATED_SYSTEMS,
  getEmulatedSystem,
  isPlayablePlatform,
  supportsRomExtension
} from '../src/emulator-systems.js';
import { EMULATORJS_INPUT_INDEX } from '../src/emulatorjs-nes-player.js';

test('NES, SNES and Mega Drive map to documented EmulatorJS system IDs', () => {
  assert.equal(EMULATED_SYSTEMS.NES.emulatorJsSystemId, 'nes');
  assert.equal(EMULATED_SYSTEMS.NES.emulatorJsCoreId, 'nestopia');
  assert.equal(EMULATED_SYSTEMS.SNES.emulatorJsSystemId, 'snes');
  assert.equal(EMULATED_SYSTEMS.SNES.emulatorJsCoreId, 'snes');
  assert.equal(EMULATED_SYSTEMS.MD.emulatorJsSystemId, 'segaMD');
  assert.equal(EMULATED_SYSTEMS.MD.emulatorJsCoreId, 'segaMD');
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
  // `.bin` is accepted for Mega Drive only because import assigns MD after checking the SEGA header.
  assert.equal(supportsRomExtension('MD', 'bin'), true);
  assert.equal(supportsRomExtension('NES', 'bin'), false);
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


test('Mega Drive touch buttons send the same RetroPad inputs as EmulatorJS\'s own segaMD layout', () => {
  // EmulatorJS 4.2.3 virtual gamepad for segaMD: A=1, B=0, C=8, X=10, Y=9, Z=11.
  const expected = { A: 1, B: 0, C: 8, X: 10, Y: 9, Z: 11 };
  for (const button of EMULATED_SYSTEMS.MD.actionButtons) {
    assert.equal(EMULATORJS_INPUT_INDEX[button.input], expected[button.label], `Mega Drive ${button.label}`);
  }
});

test('SNES touch buttons send EmulatorJS\'s snes layout inputs', () => {
  const expected = { A: 8, B: 0, X: 9, Y: 1, L: 10, R: 11 };
  for (const button of EMULATED_SYSTEMS.SNES.actionButtons) {
    assert.equal(EMULATORJS_INPUT_INDEX[button.input], expected[button.label], `SNES ${button.label}`);
  }
});

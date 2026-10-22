import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNesCore } from '../src/nes-engine.js';

test('EmulatorJS/FCEUmm is the default NES engine', () => {
  assert.equal(resolveNesCore(''), 'emulatorjs');
  assert.equal(resolveNesCore('?view=game'), 'emulatorjs');
  assert.equal(resolveNesCore('?nescore=emulatorjs'), 'emulatorjs');
});

test('legacy engines remain explicitly selectable for A/B comparison', () => {
  assert.equal(resolveNesCore('?nescore=jsnes'), 'jsnes');
  assert.equal(resolveNesCore('?nescore=nesjs'), 'nesjs');
  assert.equal(resolveNesCore('?nescore=unknown'), 'emulatorjs');
});

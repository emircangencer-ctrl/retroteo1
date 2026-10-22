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

import { buildEmulatorDocument, EMULATORJS_INPUT_INDEX } from '../src/emulatorjs-nes-player.js';

test('EmulatorJS bootstrap script is valid and starts FCEUmm automatically', () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Super Mario Bros. 3');
  const script = html.match(/<script>([\\s\\S]*?)<\\/script>/)?.[1];
  assert.ok(script, 'bootstrap script should exist in iframe HTML');
  assert.doesNotThrow(() => new Function(script), 'generated iframe JavaScript should parse');
  assert.match(script, /window\\.EJS_core = 'fceumm'/);
  assert.match(script, /window\\.EJS_startOnLoaded = true/);
  assert.match(script, /window\\.EJS_gameUrl = "blob:/);
});

test('EmulatorJS uses standard RetroArch NES joypad indices for touch and keyboard input', () => {
  assert.deepEqual(EMULATORJS_INPUT_INDEX, {
    BUTTON_B: 0, BUTTON_SELECT: 2, BUTTON_START: 3, BUTTON_UP: 4,
    BUTTON_DOWN: 5, BUTTON_LEFT: 6, BUTTON_RIGHT: 7, BUTTON_A: 8
  });
});

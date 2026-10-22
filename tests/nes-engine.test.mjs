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

test('EmulatorJS bootstrap script is valid and uses the NES system ID and starts the default NES core', () => {
  const html = buildEmulatorDocument('blob:https://retroplay.invalid/rom', 'Super Mario Bros. 3');
  const open = html.indexOf('<script>') + '<script>'.length;
  const close = html.indexOf('</script>', open);
  assert.ok(open >= 8 && close > open, 'bootstrap script should exist in iframe HTML');
  const script = html.slice(open, close);
  assert.doesNotThrow(() => new Function(script), 'generated iframe JavaScript should parse');
  assert.ok(script.includes('window.EJS_core = "nes"'));
  assert.ok(script.includes('window.EJS_startOnLoaded = true'));
  assert.ok(script.includes('window.EJS_gameUrl = "blob:'));
});

test('EmulatorJS uses standard RetroArch NES joypad indices for touch and keyboard input', () => {
  assert.deepEqual(EMULATORJS_INPUT_INDEX, {
    BUTTON_B: 0, BUTTON_Y: 1, BUTTON_SELECT: 2, BUTTON_START: 3,
    BUTTON_UP: 4, BUTTON_DOWN: 5, BUTTON_LEFT: 6, BUTTON_RIGHT: 7,
    BUTTON_A: 8, BUTTON_X: 9, BUTTON_L: 10, BUTTON_R: 11
  });
});


test('EmulatorJS bootstrap selects supported system identifiers without accepting injected values', () => {
  assert.ok(buildEmulatorDocument('blob:rom', 'SNES test', 'snes').includes('window.EJS_core = "snes"'));
  assert.ok(buildEmulatorDocument('blob:rom', 'Mega Drive test', 'segaMD').includes('window.EJS_core = "segaMD"'));
  assert.throws(() => buildEmulatorDocument('blob:rom', 'Invalid', 'unknown-core'), /Unsupported EmulatorJS system/);
});


test('EmulatorJS receives a stable game ID and configured save-update callback', () => {
  const html = buildEmulatorDocument('blob:rom', 'Test save data', 'nes', 123456);
  assert.ok(html.includes('window.EJS_gameID = 123456'));
  assert.ok(html.includes('window.EJS_fixedSaveInterval = 15000'));
  assert.ok(html.includes('window.EJS_onSaveUpdate = event'));
});

test('save update callback clones the SRAM buffer before posting it to the host app', () => {
  const messages = [];
  const transfers = [];
  const context = {
    document: {
      head: { appendChild: () => {} },
      createElement: () => ({})
    },
    parent: {
      postMessage: (message, target, transfer) => {
        messages.push(message);
        transfers.push(transfer);
      }
    },
    addEventListener: () => {}
  };
  context.window = context;
  const html = buildEmulatorDocument('blob:rom', 'Save callback', 'nes', 123);
  const open = html.indexOf('<script>') + '<script>'.length;
  const close = html.indexOf('</script>', open);
  runInNewContext(html.slice(open, close), context);
  const saveData = runInNewContext('new Uint8Array([10, 20, 30])', context);
  context.EJS_onSaveUpdate({ hash: 'save-hash', save: saveData });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].source, 'retroplay-emulatorjs');
  assert.equal(messages[0].type, 'save-update');
  assert.equal(messages[0].hash, 'save-hash');
  assert.ok(messages[0].saveBuffer instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(messages[0].saveBuffer)], [10, 20, 30]);
  assert.equal(transfers[0].length, 1);
});

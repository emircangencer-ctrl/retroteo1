import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { resolveNesCore } from '../src/nes-engine.js';

test('EmulatorJS is default; Nestopia is default core and FCEUmm is explicit', () => {
  assert.equal(resolveNesCore(''), 'emulatorjs');
  assert.equal(resolveNesCore('?view=game'), 'emulatorjs');
  assert.equal(resolveNesCore('?nescore=emulatorjs'), 'emulatorjs');
  assert.equal(resolveNesCore('?nescore=fceumm'), 'emulatorjs', 'FCEUmm remains within the EmulatorJS player; the app chooses it explicitly');
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
  assert.ok(script.includes('https://cdn.emulatorjs.org/4.2.3/data/'), 'runtime should use the pinned CDN release');
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


test('EmulatorJS receives a stable game ID and no save hooks that 4.2.3 does not implement', () => {
  const html = buildEmulatorDocument('blob:rom', 'Test save data', 'nes', 123456);
  assert.ok(html.includes('window.EJS_gameID = 123456'));
  // EJS_onSaveUpdate / EJS_fixedSaveInterval exist only on EmulatorJS's unreleased main branch.
  // The pinned 4.2.3 runtime ignores them, so the app copies SRAM out of the core itself.
  assert.ok(!html.includes('EJS_onSaveUpdate'));
  assert.ok(!html.includes('EJS_fixedSaveInterval'));
});

function bootstrapContext() {
  const messages = [];
  const listeners = {};
  const context = {
    document: { head: { appendChild: () => {} }, createElement: () => ({}) },
    parent: { postMessage: message => messages.push(message) },
    addEventListener: (type, listener) => { (listeners[type] ||= []).push(listener); }
  };
  context.window = context;
  const html = buildEmulatorDocument('blob:rom', 'Bootstrap', 'nes', 123);
  const open = html.indexOf('<script>') + '<script>'.length;
  const close = html.indexOf('</script>', open);
  runInNewContext(html.slice(open, close), context);
  return { context, messages, listeners };
}

test('runtime errors before game start are fatal errors', () => {
  const { messages, listeners } = bootstrapContext();
  listeners.unhandledrejection[0]({ reason: new Error('core download failed') });
  assert.equal(messages.at(-1).type, 'error');
  assert.equal(messages.at(-1).message, 'core download failed');
});

test('runtime rejections after game start are warnings, not a stopped session', () => {
  const { context, messages, listeners } = bootstrapContext();
  context.EJS_emulator = { gameManager: { simulateInput: () => {} }, pause: () => {}, play: () => {} };
  context.EJS_onGameStart();
  assert.equal(messages.at(-1).type, 'started');
  listeners.unhandledrejection[0]({ reason: new Error('Wake Lock permission request denied') });
  assert.equal(messages.at(-1).type, 'warning');
  listeners.error[0]({ message: 'late script error' });
  assert.equal(messages.at(-1).type, 'warning');
});

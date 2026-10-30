import test from 'node:test';
import assert from 'node:assert/strict';
import { readBridge, detectTv, createGamepadSource, padKeys, parseJson } from '../src/lib/tv.ts';
import { readGamepad } from '../src/gamepad-input.js';

const pad = (index, pressed = [], axes = [0, 0, 0, 0]) => ({ index, id: `Pad ${index}`, timestamp: 5, axes, buttons: Array.from({ length: 17 }, (_, b) => [pressed.includes(b) ? 1 : 0, pressed.includes(b) ? 1 : 0]) });

test('the TV app is recognised by its bridge, its user agent token or ?tv=1', () => {
  const bridge = { info: () => '{}', gamepads: () => '{}' };
  assert.equal(readBridge({ RetroPlayTV: bridge }), bridge);
  assert.equal(readBridge({ RetroPlayTV: { info: 1 } }), null);
  assert.equal(detectTv({ RetroPlayTV: bridge }), true);
  assert.equal(detectTv({ location: { search: '?tv=1' } }), true);
  assert.equal(detectTv({ location: { search: '?x=1&tv=1' } }), true);
  assert.equal(detectTv({ location: { search: '?tv=10' } }), false);
  assert.equal(detectTv({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; BRAVIA) Chrome/130 RetroPlayTV/1.0.4' } }), true);
  assert.equal(detectTv({ navigator: { userAgent: 'Mozilla/5.0 Chrome/130' }, location: { search: '' } }), false);
});

test('controllers from the bridge look like standard browser gamepads; parsed only when they change', () => {
  let version = 1, reads = 0;
  let pads = [pad(0, [0, 12], [0.5, -1, 0, 0])];
  const getGamepads = createGamepadSource({ gamepadVersion: () => version, gamepads: () => { reads++; return JSON.stringify({ v: version, pads }); } });
  const list = getGamepads();
  assert.equal(list.length, 4);
  assert.equal(list[0].mapping, 'standard');
  assert.equal(list[0].buttons[0].pressed, true);
  assert.equal(list[0].buttons[1].pressed, false);
  assert.deepEqual(list[0].axes, [0.5, -1, 0, 0]);
  assert.equal(getGamepads(), list, 'same version: the same list, no new parse');
  assert.equal(reads, 1);
  // RetroPlay's own controller reader understands it: bottom button = RetroPad B, d-pad up.
  const state = readGamepad(list[0]);
  assert.ok(state.buttons.has('BUTTON_B') && state.buttons.has('BUTTON_UP'));
  version = 2; pads = [pad(0), pad(2, [16])];
  const next = getGamepads();
  assert.equal(reads, 2);
  assert.equal(next[2].id, 'Pad 2');
  assert.equal(readGamepad(next[2]).menu, true, 'the guide button opens the menu');
  assert.equal(padKeys(next), '0:Pad 0|2:Pad 2');
});

test('a broken bridge answer never breaks the reader', () => {
  const getGamepads = createGamepadSource({ gamepadVersion: () => 3, gamepads: () => 'not json' });
  assert.deepEqual(getGamepads(), [null, null, null, null]);
  const failing = createGamepadSource({ gamepadVersion: () => { throw new Error('gone'); }, gamepads: () => '{}' });
  assert.deepEqual(failing(), [null, null, null, null]);
  assert.deepEqual(parseJson('', []), []);
  assert.deepEqual(parseJson('{"a":1}', null), { a: 1 });
});

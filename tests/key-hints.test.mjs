import test from 'node:test';
import assert from 'node:assert/strict';
import { keyHints, keysFor, keyCap, PRIMARY_SYSTEM_KEY } from '../src/lib/key-hints.ts';
import { padSpecFor } from '../src/touch-layout.js';
import { KEYBOARD_MAP } from '../src/emulatorjs-nes-player.js';

const flat = hints => hints.map(h => `${h.codes.join('+')}=${h.label}`);

test('every key the hints name really presses that button', () => {
  for (const [platform, layout, arcade] of [['NES'], ['SNES'], ['MD'], ['ARCADE', 'six'], ['ARCADE', 'neogeo'], ['ARCADE', 'six', { core: 'fbneo', buttons: 2 }]]) {
    const spec = padSpecFor(platform, layout, arcade || null);
    for (const hint of keyHints(spec, { arcade: platform === 'ARCADE' }).filter(h => h.kind === 'button' || h.kind === 'system')) {
      const inputs = [...spec.face, ...spec.shoulders, ...spec.system].map(b => b.input);
      assert.ok(inputs.includes(KEYBOARD_MAP[hint.codes[0]]), `${platform}: ${hint.codes[0]} → ${KEYBOARD_MAP[hint.codes[0]]}`);
    }
  }
});

test('arcade: joystick, six numbered buttons in key order, 5 = Jeton, 1 = Başla', () => {
  assert.deepEqual(flat(keyHints(padSpecFor('ARCADE', 'six'), { arcade: true })), [
    'ArrowUp+ArrowDown+ArrowLeft+ArrowRight=joystick',
    'KeyZ=1', 'KeyX=2', 'KeyA=3', 'KeyS=4', 'KeyQ=5', 'KeyW=6',
    'Digit5=Jeton', 'Digit1=Başla', 'Escape=menü'
  ]);
});

test('a cabinet without buttons (Pac-Man) shows only the joystick, coin and start', () => {
  const spec = padSpecFor('ARCADE', 'six', { core: 'fbneo', buttons: 0, ways: 4 });
  assert.deepEqual(flat(keyHints(spec, { arcade: true })), ['ArrowUp+ArrowDown+ArrowLeft+ArrowRight=joystick', 'Digit5=Jeton', 'Digit1=Başla', 'Escape=menü']);
});

test('Neo Geo keeps SNK letters; NES and Mega Drive keep their own labels', () => {
  assert.deepEqual(flat(keyHints(padSpecFor('ARCADE', 'neogeo'), { arcade: true })).slice(1, 5), ['KeyZ=A', 'KeyX=B', 'KeyA=C', 'KeyS=D']);
  assert.deepEqual(flat(keyHints(padSpecFor('NES'))), ['ArrowUp+ArrowDown+ArrowLeft+ArrowRight=yön', 'KeyZ=B', 'KeyX=A', 'ShiftRight=Select', 'Enter=Start', 'Escape=menü']);
  const md = flat(keyHints(padSpecFor('MD')));
  assert.deepEqual(md.slice(1, 7), ['KeyZ=B', 'KeyX=C', 'KeyA=A', 'KeyS=Y', 'KeyQ=X', 'KeyW=Z']);
  assert.ok(!md.some(h => /Select/.test(h)), 'the Mega Drive pad has no Select');
});

test('coin and start have keys every keyboard has; Right Ctrl still works', () => {
  assert.deepEqual(keysFor('BUTTON_SELECT').sort(), ['ControlRight', 'Digit5', 'KeyV', 'ShiftRight']);
  assert.deepEqual(keysFor('BUTTON_START').sort(), ['Digit1', 'Enter', 'NumpadEnter']);
  assert.equal(PRIMARY_SYSTEM_KEY.arcade.BUTTON_SELECT, 'Digit5');
});

test('key caps follow the keyboard layout when the browser reports it', () => {
  assert.equal(keyCap('KeyZ'), 'Z');
  assert.equal(keyCap('Digit5'), '5');
  assert.equal(keyCap('ShiftRight'), 'Sağ Shift');
  // A Turkish F keyboard carries other letters on these positions.
  const f = new Map([['KeyZ', 'j'], ['KeyX', 'ö'], ['KeyA', 'u'], ['KeyS', 'i']]);
  assert.deepEqual(['KeyZ', 'KeyX', 'KeyA', 'KeyS'].map(code => keyCap(code, f)), ['J', 'Ö', 'U', 'İ']);
});

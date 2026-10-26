import test from 'node:test';
import assert from 'node:assert/strict';
import { readGamepad, GamepadPoller, STANDARD_TO_RETROPAD, MENU_BUTTON_INDEX } from '../src/gamepad-input.js';

function pad({ pressed = [], axes = [0, 0, 0, 0], mapping = 'standard', index = 0, values = {} } = {}) {
  return {
    index, mapping, connected: true, id: 'Test pad', axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) }))
  };
}
const names = state => [...state.buttons].sort().join('+') || '-';

test('buttons map by position like RetroArch: bottom = B, right = A, left = Y, top = X', () => {
  assert.equal(STANDARD_TO_RETROPAD[0], 'BUTTON_B');
  assert.equal(STANDARD_TO_RETROPAD[1], 'BUTTON_A');
  assert.equal(STANDARD_TO_RETROPAD[2], 'BUTTON_Y');
  assert.equal(STANDARD_TO_RETROPAD[3], 'BUTTON_X');
  assert.equal(names(readGamepad(pad({ pressed: [0, 9, 12] }))), 'BUTTON_B+BUTTON_START+BUTTON_UP');
  assert.equal(names(readGamepad(pad({ pressed: [4, 5, 8] }))), 'BUTTON_L+BUTTON_R+BUTTON_SELECT');
  assert.equal(names(readGamepad(pad({ values: { 7: 0.8 } }))), 'BUTTON_R2', 'analog triggers count past half way');
  assert.equal(names(readGamepad(pad({ values: { 7: 0.2 } }))), '-');
});

test('left stick works as a d-pad with a dead zone; the guide button is the menu', () => {
  assert.equal(names(readGamepad(pad({ axes: [0.9, -0.9, 0, 0] }))), 'BUTTON_RIGHT+BUTTON_UP');
  assert.equal(names(readGamepad(pad({ axes: [-1, 0.05, 0, 0] }))), 'BUTTON_LEFT');
  assert.equal(names(readGamepad(pad({ axes: [0.3, 0.2, 0, 0] }))), '-', 'stick drift is ignored');
  const state = readGamepad(pad({ pressed: [MENU_BUTTON_INDEX] }));
  assert.equal(state.menu, true);
  assert.equal(state.active, true);
  assert.equal(readGamepad(pad()).active, false);
});

test('non-standard controllers: hat switch on axis 9', () => {
  const hat = value => names(readGamepad(pad({ mapping: '', axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, value] })));
  assert.equal(hat(-1), 'BUTTON_UP');
  assert.equal(hat(-1 + 2 / 7 * 2), 'BUTTON_RIGHT');
  assert.equal(hat(1), 'BUTTON_LEFT+BUTTON_UP');
  assert.equal(hat(3.28), '-', 'centred');
});

test('the poller reports presses and releases once, unions controllers, and opens the menu on the guide edge', () => {
  let pads = [pad()];
  const changes = [];
  let activity = 0, menus = 0;
  const poller = new GamepadPoller({ getGamepads: () => pads, onChange: (p, r) => changes.push([p.join(','), r.join(',')]), onActivity: () => activity++, onMenu: () => menus++, requestFrame: () => 1, cancelFrame: () => {} });
  poller.poll();
  assert.deepEqual(changes, []);
  pads = [pad({ pressed: [0] }), pad({ index: 1, pressed: [1] })];
  poller.poll();
  poller.poll();
  assert.deepEqual(changes, [['BUTTON_B,BUTTON_A', '']]);
  pads = [pad({ pressed: [0, MENU_BUTTON_INDEX] })];
  poller.poll();
  poller.poll();
  assert.deepEqual(changes.at(-1), ['', 'BUTTON_A']);
  assert.equal(menus, 1, 'held guide button opens the menu once');
  assert.ok(activity >= 3);
  poller.stop();
  assert.deepEqual(changes.at(-1), ['', 'BUTTON_B'], 'stopping releases what was held');
  pads = [null, undefined];
  assert.deepEqual(poller.poll(), { pressed: [], released: [] });
});

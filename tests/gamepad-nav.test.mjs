import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNeighbor, heldDirection, NavReader } from '../src/lib/gamepad-nav.ts';

const r = (left, top, width = 100, height = 40) => ({ left, top, width, height });

test('the focus moves to the nearest control in the pressed direction, preferring ones in line', () => {
  //  [A][B][C]
  //  [D]   [E]
  const A = r(0, 0), B = r(120, 0), C = r(240, 0), D = r(0, 60), E = r(240, 60);
  const all = [A, B, C, D, E];
  const others = from => all.filter(x => x !== from);
  const go = (from, dir) => { const list = others(from); const i = pickNeighbor(from, list, dir); return i < 0 ? null : all.indexOf(list[i]); };
  assert.equal(go(A, 'right'), 1);
  assert.equal(go(B, 'right'), 2);
  assert.equal(go(C, 'right'), null, 'nothing further right');
  assert.equal(go(A, 'down'), 3);
  assert.equal(go(B, 'down'), 3, 'no control straight below B: the nearest one below');
  assert.equal(go(E, 'up'), 2);
  assert.equal(go(D, 'right'), 4, 'in line with D wins over B diagonally up');
  assert.equal(go(E, 'left'), 3);
});

test('direction from d-pad buttons, the left stick or a hat switch', () => {
  const pad = (pressed = [], axes = [0, 0], mapping = 'standard') => ({ mapping, axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
  assert.equal(heldDirection(pad([12])), 'up');
  assert.equal(heldDirection(pad([15])), 'right');
  assert.equal(heldDirection(pad([], [0.1, -0.9])), 'up');
  assert.equal(heldDirection(pad([], [-0.8, 0.3])), 'left');
  assert.equal(heldDirection(pad([], [0.3, 0.2])), null, 'drift is ignored');
  assert.equal(heldDirection(pad([], [0, 0, 0, 0, 0, 0, 0, 0, 0, 1 / 7], '')), 'down');
});

test('a press acts once; a held direction repeats like a key; buttons held when reading starts do not act', () => {
  const reader = new NavReader({ delay: 300, repeat: 100 });
  const pad = (pressed = []) => [{ mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) }];
  assert.deepEqual(reader.poll(pad([0]), 0), [], 'A was held when the menu opened: priming frame');
  assert.deepEqual(reader.poll(pad([0]), 16), [], 'still the same press');
  assert.deepEqual(reader.poll(pad([]), 32), []);
  assert.deepEqual(reader.poll(pad([0]), 48), [{ type: 'confirm' }]);
  assert.deepEqual(reader.poll(pad([1, 9]), 64).map(a => a.type).sort(), ['back', 'start']);
  assert.deepEqual(reader.poll(pad([13]), 100), [{ type: 'move', dir: 'down' }]);
  assert.deepEqual(reader.poll(pad([13]), 300), [], 'no repeat before the delay');
  assert.deepEqual(reader.poll(pad([13]), 400), [{ type: 'move', dir: 'down' }]);
  assert.deepEqual(reader.poll(pad([13]), 450), []);
  assert.deepEqual(reader.poll(pad([13]), 500), [{ type: 'move', dir: 'down' }]);
  assert.deepEqual(reader.poll(pad([14]), 510), [{ type: 'move', dir: 'left' }], 'a new direction acts at once');
  reader.reset();
  assert.deepEqual(reader.poll(pad([2, 3, 4, 5]), 600), []);
  assert.deepEqual(reader.poll(pad([]), 616), []);
  assert.deepEqual(reader.poll(pad([2, 3, 4, 5, 8, 16]), 632).map(a => a.type).sort(), ['guide', 'l', 'r', 'select', 'x', 'y']);
  assert.deepEqual(reader.poll([null, { connected: false, buttons: [{ pressed: true }] }], 700), [], 'missing or disconnected pads are skipped');
});

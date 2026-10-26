import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchController } from '../src/touch-controller.js';
import { computeTouchLayout, PAD_SPECS } from '../src/touch-layout.js';

/** Just enough of an element for the controller's pointer logic (no rendering). */
function fakeRoot() {
  const listeners = {};
  const captured = new Set();
  return {
    listeners, captured, dataset: {}, style: { setProperty() {} },
    classList: { toggle() {} },
    set innerHTML(_) {},
    addEventListener(type, fn) { listeners[type] = fn; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture(id) { captured.add(id); },
    querySelector: () => null,
    querySelectorAll: () => []
  };
}
function setup(spec = PAD_SPECS.nes, settings = {}) {
  const root = fakeRoot();
  const log = [];
  const buzz = [];
  let t = 0;
  const pad = new TouchController(root, { press: i => log.push(`+${i}`), release: i => log.push(`-${i}`), vibrate: ms => buzz.push(ms), now: () => (t += 100) });
  pad.setSettings(settings);
  const layout = computeTouchLayout({ width: 393, height: 873, spec, settings });
  pad.render(layout);
  const ev = (type, id, x, y) => { let prevented = false; root.listeners[type]({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y, preventDefault() { prevented = true; } }); return prevented; };
  const held = () => [...pad.held].sort().join('+') || '-';
  return { root, pad, layout, log, buzz, ev, held };
}

test('one thumb rolls around the d-pad without lifting; past the cross still steers', () => {
  const { layout, ev, held, log } = setup();
  const { cx, cy, r } = layout.dpad;
  ev('pointerdown', 1, cx, cy - r * 0.6);
  assert.equal(held(), 'BUTTON_UP');
  ev('pointermove', 1, cx + r * 0.45, cy - r * 0.45);
  assert.equal(held(), 'BUTTON_RIGHT+BUTTON_UP');
  ev('pointermove', 1, cx + r * 0.7, cy);
  assert.equal(held(), 'BUTTON_RIGHT');
  ev('pointermove', 1, cx + r * 2.2, cy + r * 0.1);
  assert.equal(held(), 'BUTTON_RIGHT', 'the finger left the drawn d-pad but is still on it');
  ev('pointerup', 1, cx + r * 2.2, cy);
  assert.equal(held(), '-');
  assert.deepEqual(log, ['+BUTTON_UP', '+BUTTON_RIGHT', '-BUTTON_UP', '-BUTTON_RIGHT']);
});

test('every finger counts on its own: d-pad + B, then B slides to A, a thumb between presses both', () => {
  const { layout, ev, held, buzz } = setup();
  const [B, A] = layout.face;
  ev('pointerdown', 1, layout.dpad.cx - layout.dpad.r * 0.7, layout.dpad.cy);
  ev('pointerdown', 2, B.cx, B.cy);
  assert.equal(held(), 'BUTTON_B+BUTTON_LEFT');
  ev('pointermove', 2, (A.cx + B.cx) / 2, (A.cy + B.cy) / 2);
  assert.equal(held(), 'BUTTON_A+BUTTON_B+BUTTON_LEFT');
  ev('pointermove', 2, A.cx, A.cy);
  assert.equal(held(), 'BUTTON_A+BUTTON_LEFT');
  ev('pointercancel', 2, A.cx, A.cy); // e.g. the system took the touch
  assert.equal(held(), 'BUTTON_LEFT');
  ev('pointerup', 1, 0, 0);
  assert.equal(held(), '-');
  assert.deepEqual(buzz, [8, 14, 14], 'a short buzz for each new press (shorter for directions), none for releases');
});

test('system and shoulder buttons: press on touch, release when the finger slides off', () => {
  const { layout, ev, held } = setup(PAD_SPECS.snes);
  const start = layout.system.find(b => b.id === 'start');
  const l = layout.shoulders.find(b => b.id === 'l');
  ev('pointerdown', 5, start.x + start.w / 2, start.y + start.h / 2);
  ev('pointerdown', 6, l.x + 10, l.y + 10);
  assert.equal(held(), 'BUTTON_L+BUTTON_START');
  ev('pointermove', 5, start.x + start.w / 2, start.y - 60);
  assert.equal(held(), 'BUTTON_L');
  ev('pointerup', 6, 0, 0);
  ev('pointerup', 5, 0, 0);
  assert.equal(held(), '-');
});

test('touches outside the pad do nothing and are not captured; settings switch 4-way, floating d-pad and haptics', () => {
  const plain = setup();
  plain.ev('pointerdown', 9, 196, 200); // on the picture
  assert.equal(plain.held(), '-');
  assert.equal(plain.root.captured.has(9), false);

  const four = setup(PAD_SPECS.nes, { dpadMode: '4', haptics: false });
  const d = four.layout.dpad;
  four.ev('pointerdown', 1, d.cx + d.r * 0.5, d.cy - d.r * 0.45);
  assert.equal(four.held(), 'BUTTON_RIGHT', 'no diagonals in 4-way mode');
  assert.deepEqual(four.buzz, [], 'vibration off');

  const floating = setup(PAD_SPECS.nes, { floating: true });
  const area = floating.layout.dpad.area;
  // A touch far from the drawn d-pad becomes its centre, then moving up presses up.
  floating.ev('pointerdown', 1, area.x + area.w * 0.5, area.y + 30 + floating.layout.dpad.r);
  assert.equal(floating.held(), '-');
  floating.ev('pointermove', 1, area.x + area.w * 0.5, area.y + 30);
  assert.equal(floating.held(), 'BUTTON_UP');
});

test('releaseAll lifts every finger (menu, app switch, rotation)', () => {
  const { layout, ev, held, pad, log } = setup();
  ev('pointerdown', 1, layout.dpad.cx, layout.dpad.cy - layout.dpad.r * 0.7);
  ev('pointerdown', 2, layout.face[1].cx, layout.face[1].cy);
  pad.releaseAll();
  assert.equal(held(), '-');
  assert.deepEqual(log.slice(-2).sort(), ['-BUTTON_A', '-BUTTON_UP']);
  ev('pointermove', 1, layout.dpad.cx, layout.dpad.cy + 50);
  assert.equal(held(), '-', 'a finger from before releaseAll is ignored until it touches again');
});

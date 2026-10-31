import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTouchLayout, dpadSector, sectorButtons, faceButtonsAt, normalizeTouchSettings, padSpecFor, PAD_SPECS, DIAGONAL_WIDTH, DEFAULT_TOUCH_SETTINGS } from '../src/touch-layout.js';

const at = degrees => [Math.cos((degrees * Math.PI) / 180) * 50, -Math.sin((degrees * Math.PI) / 180) * 50];
const dirs = (degrees, options) => sectorButtons(dpadSector(...at(degrees), 80, options)).join('+') || '-';

test('d-pad: 8 directions by angle, a dead zone in the middle', () => {
  assert.equal(dirs(0), 'BUTTON_RIGHT');
  assert.equal(dirs(45), 'BUTTON_UP+BUTTON_RIGHT');
  assert.equal(dirs(90), 'BUTTON_UP');
  assert.equal(dirs(135), 'BUTTON_UP+BUTTON_LEFT');
  assert.equal(dirs(180), 'BUTTON_LEFT');
  assert.equal(dirs(225), 'BUTTON_DOWN+BUTTON_LEFT');
  assert.equal(dirs(270), 'BUTTON_DOWN');
  assert.equal(dirs(315), 'BUTTON_DOWN+BUTTON_RIGHT');
  assert.equal(dpadSector(5, -5, 80), -1, 'a thumb resting on the centre presses nothing');
  assert.equal(dpadSector(400, 0, 80), 0, 'far past the drawn cross still counts');
});

test('d-pad: cardinal directions are wider than diagonals; the diagonal width is adjustable', () => {
  // Normal: diagonals 40°, so "right" spans ±25°.
  assert.equal(dirs(24), 'BUTTON_RIGHT');
  assert.equal(dirs(26), 'BUTTON_UP+BUTTON_RIGHT');
  assert.equal(dirs(24, { diagonal: DIAGONAL_WIDTH.cok }), 'BUTTON_UP+BUTTON_RIGHT', '"Kolay" makes diagonals easier');
  assert.equal(dirs(30, { diagonal: DIAGONAL_WIDTH.az }), 'BUTTON_RIGHT', '"Zor" keeps a slightly tilted thumb straight');
});

test('d-pad: a direction holds at the edge (hysteresis) and 4-way mode has no diagonals', () => {
  const right = dpadSector(...at(20), 80);
  assert.equal(right, 0);
  assert.equal(dpadSector(...at(30), 80, { previous: right }), 0, 'still right 5° past the edge');
  assert.equal(dpadSector(...at(36), 80, { previous: right }), 1, 'clearly into up-right');
  assert.equal(dpadSector(...at(30), 80), 1, 'without history 30° is up-right');
  assert.equal(dirs(40, { fourWay: true }), 'BUTTON_RIGHT');
  assert.equal(dirs(50, { fourWay: true }), 'BUTTON_UP');
  // Leaving the dead zone needs 20 % of the radius, staying in a direction only 14 %.
  assert.equal(dpadSector(13, 0, 80), -1);
  assert.equal(dpadSector(13, 0, 80, { previous: 0 }), 0);
});

test('face buttons: generous edges, both buttons in the gap, nothing far away', () => {
  const b = { id: 'b', input: 'BUTTON_B', cx: 100, cy: 100, r: 30 };
  const a = { id: 'a', input: 'BUTTON_A', cx: 175, cy: 90, r: 30 };
  const hit = (x, y) => faceButtonsAt(x, y, [b, a]).map(button => button.id).join('+') || '-';
  assert.equal(hit(100, 100), 'b');
  assert.equal(hit(100, 135), 'b', 'just below the drawn edge still presses');
  assert.equal(hit(137.5, 95), 'b+a', 'a thumb laid between B and A presses both');
  assert.equal(hit(160, 92), 'a');
  assert.equal(hit(100, 160), '-');
});

test('settings are clamped and defaulted', () => {
  assert.deepEqual(normalizeTouchSettings({}), { ...DEFAULT_TOUCH_SETTINGS });
  const s = normalizeTouchSettings({ scale: 9, opacity: 0, haptics: 'yes', dpadMode: '4', diagonal: 'x', floating: true });
  assert.equal(s.scale, 1.3);
  assert.equal(s.opacity, 0.3);
  assert.equal(s.haptics, true);
  assert.equal(s.dpadMode, '4');
  assert.equal(s.diagonal, 'normal');
  assert.equal(s.floating, true);
});

test('each console gets its own pad', () => {
  assert.equal(padSpecFor('NES').id, 'nes');
  assert.equal(padSpecFor('SNES').id, 'snes');
  assert.equal(padSpecFor('MD').id, 'md');
  assert.equal(padSpecFor('ARCADE').id, 'arcade6');
  assert.equal(padSpecFor('ARCADE', 'neogeo').id, 'neogeo');
  assert.deepEqual(PAD_SPECS.nes.face.map(b => `${b.label}=${b.input}`), ['B=BUTTON_B', 'A=BUTTON_A']);
  assert.deepEqual(PAD_SPECS.snes.face.map(b => `${b.label}=${b.input}`), ['X=BUTTON_X', 'Y=BUTTON_Y', 'A=BUTTON_A', 'B=BUTTON_B']);
  assert.deepEqual(PAD_SPECS.snes.shoulders.map(b => b.input), ['BUTTON_L', 'BUTTON_R']);
  // Genesis Plus GX: A=Y, B=B, C=A, X=L, Y=X, Z=R.
  assert.deepEqual(PAD_SPECS.md.face.map(b => `${b.label}=${b.input}`), ['A=BUTTON_Y', 'B=BUTTON_B', 'C=BUTTON_A', 'X=BUTTON_L', 'Y=BUTTON_X', 'Z=BUTTON_R']);
  assert.deepEqual(PAD_SPECS.md.system.map(b => b.label), ['START']);
  // FinalBurn Neo / FB Alpha 2012: Y X L on top, B A R below.
  assert.deepEqual(PAD_SPECS.arcade6.face.map(b => b.input), ['BUTTON_Y', 'BUTTON_X', 'BUTTON_L', 'BUTTON_B', 'BUTTON_A', 'BUTTON_R']);
  assert.deepEqual(PAD_SPECS.arcade6.system.map(b => b.label), ['JETON', 'START']);
  // FinalBurn Neo Neo Geo: A=B, B=A, C=Y, D=X.
  assert.deepEqual(PAD_SPECS.neogeo.face.map(b => `${b.label}=${b.input}`), ['A=BUTTON_B', 'B=BUTTON_A', 'C=BUTTON_Y', 'D=BUTTON_X']);
});

const SCREENS = [
  [360, 780], [393, 873], [412, 915], [430, 932], [768, 1024], // portrait phones, tablet
  [780, 360], [873, 393], [915, 412], [740, 360], [1024, 768] // landscape
];
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const circleBox = c => ({ x: c.cx - c.r, y: c.cy - c.r, w: c.r * 2, h: c.r * 2 });

for (const [width, height] of SCREENS) {
  for (const spec of Object.values(PAD_SPECS)) {
    test(`layout ${spec.id} on ${width}×${height}: on screen, thumb-sized, nothing overlaps`, () => {
      const L = computeTouchLayout({ width, height, spec });
      const all = [circleBox(L.dpad), ...L.face.map(circleBox), ...L.shoulders, ...L.system];
      for (const box of all) {
        assert.ok(box.x >= 8 && box.y >= 0 && box.x + box.w <= width - 8 && box.y + box.h <= height - 4, `${JSON.stringify(box)} inside ${width}×${height}`);
      }
      assert.ok(L.dpad.cx - L.dpad.r >= 14, 'the d-pad keeps clear of the system back-gesture edge');
      assert.ok(L.dpad.r * 2 >= 110, `d-pad ${L.dpad.r * 2}px`);
      for (const b of L.face) assert.ok(b.r * 2 >= (spec.id === 'md' && b.label.match(/[XYZ]/) ? 30 : 40), `${spec.id} ${b.label} ${b.r * 2}px`);
      for (let i = 0; i < L.face.length; i++) {
        for (let j = i + 1; j < L.face.length; j++) {
          const p = L.face[i], q = L.face[j];
          assert.ok(Math.hypot(p.cx - q.cx, p.cy - q.cy) >= p.r + q.r, `${p.id}/${q.id} overlap`);
        }
        assert.ok(Math.hypot(L.face[i].cx - L.dpad.cx, L.face[i].cy - L.dpad.cy) > L.face[i].r + L.dpad.r, 'face button over the d-pad');
      }
      for (const s of [...L.system, ...L.shoulders]) {
        assert.ok(!overlaps(s, circleBox(L.dpad)), `${s.id} over the d-pad`);
        for (const b of L.face) assert.ok(!overlaps(s, circleBox(b)), `${s.id} over ${b.id}`);
      }
      if (L.orientation === 'portrait') {
        assert.equal(L.screen.y, 48, 'picture right under the bar');
        for (const box of all) assert.ok(box.y >= L.screen.y + L.screen.h, 'the pad never covers the picture in portrait');
        assert.ok(L.screen.w >= Math.min(width, 640) * 0.9 || L.screen.h >= (height - 48) * 0.49, 'picture as big as the width allows');
      } else {
        assert.ok(L.screen.h >= height * 0.62, 'picture uses the height');
        if (!L.overlay) for (const box of all) assert.ok(!overlaps(box, L.screen), 'beside the picture when it fits');
      }
    });
  }
}

test('20:9 phones in landscape: NES and Neo Geo pads fit beside the picture; arcade reaches ≤ 24 px over it', () => {
  assert.equal(computeTouchLayout({ width: 873, height: 393, spec: PAD_SPECS.nes }).overlay, false);
  assert.equal(computeTouchLayout({ width: 873, height: 393, spec: PAD_SPECS.neogeo }).overlay, false);
  const arcade = computeTouchLayout({ width: 873, height: 393, spec: PAD_SPECS.arcade6 });
  const left = Math.min(...arcade.face.map(b => b.cx - b.r));
  assert.ok(left >= arcade.screen.x + arcade.screen.w - 26, `${left} vs ${arcade.screen.x + arcade.screen.w}`);
  assert.ok(arcade.face.every(b => b.r * 2 >= 52));
});

test('vertical arcade games get a tall picture; notches and gesture bars are respected', () => {
  const tall = computeTouchLayout({ width: 393, height: 873, aspect: 3 / 4, spec: PAD_SPECS.arcade6 });
  assert.ok(tall.screen.h > tall.screen.w);
  const notched = computeTouchLayout({ width: 873, height: 393, spec: PAD_SPECS.snes, safe: { left: 32, right: 32, bottom: 12 } });
  assert.ok(notched.dpad.cx - notched.dpad.r >= 32 + 14);
  assert.ok(Math.max(...notched.face.map(b => b.cx + b.r)) <= 873 - 32 - 14);
  assert.ok(Math.max(...notched.system.map(b => b.y + b.h)) <= 393 - 12);
  const portraitNotch = computeTouchLayout({ width: 393, height: 873, spec: PAD_SPECS.nes, safe: { top: 30, bottom: 24 } });
  assert.equal(portraitNotch.screen.y, 78);
  assert.ok(Math.max(...portraitNotch.system.map(b => b.y + b.h)) <= 873 - 24);
});

test('size setting scales the pad; a hidden pad (controller in use) gives the picture the screen', () => {
  const normal = computeTouchLayout({ width: 393, height: 873, spec: PAD_SPECS.snes });
  const big = computeTouchLayout({ width: 393, height: 873, spec: PAD_SPECS.snes, settings: { scale: 1.3 } });
  const small = computeTouchLayout({ width: 393, height: 873, spec: PAD_SPECS.snes, settings: { scale: 0.8 } });
  assert.ok(small.dpad.r < normal.dpad.r);
  assert.ok(small.face[0].r < normal.face[0].r && normal.face[0].r <= big.face[0].r);
  const hidden = computeTouchLayout({ width: 393, height: 873, spec: PAD_SPECS.nes, padHidden: true });
  assert.equal(hidden.padHidden, true);
  assert.ok(hidden.screen.y > normal.screen.y, 'centred vertically');
});

test('arcade pads follow the cabinet: FinalBurn Neo games get only their buttons, 4-way games a 4-way d-pad', () => {
  const fb = buttons => padSpecFor('ARCADE', 'six', { core: 'fbneo', buttons, ways: 8 });
  assert.deepEqual(fb(0).face, []);
  assert.deepEqual(fb(1).face.map(b => b.input), ['BUTTON_B']);
  assert.deepEqual(fb(2).face.map(b => `${b.label}=${b.input}`), ['1=BUTTON_B', '2=BUTTON_A']);
  assert.deepEqual(fb(3).face.map(b => b.input), ['BUTTON_B', 'BUTTON_A', 'BUTTON_Y']);
  assert.deepEqual(fb(4).face.map(b => b.input).sort(), ['BUTTON_A', 'BUTTON_B', 'BUTTON_X', 'BUTTON_Y']);
  assert.equal(fb(6), PAD_SPECS.arcade6);
  assert.equal(padSpecFor('ARCADE', 'six', { core: 'fbneo', buttons: 2, ways: 8 }, { arcadeButtons: 'all' }), PAD_SPECS.arcade6, '"Altısı da" shows the full panel');
  assert.equal(padSpecFor('ARCADE', 'six', { core: 'fbalpha2012_cps2', buttons: 2, ways: 8 }), PAD_SPECS.arcade6, 'FB Alpha 2012 maps buttons by name: full panel');
  assert.equal(padSpecFor('ARCADE', 'six', null), PAD_SPECS.arcade6, 'unknown cabinet: full panel');
  assert.equal(padSpecFor('ARCADE', 'neogeo', { core: 'fbneo', buttons: 4, ways: 8 }), PAD_SPECS.neogeo);
  const pacman = padSpecFor('ARCADE', 'six', { core: 'fbneo', buttons: 0, ways: 4 });
  assert.equal(pacman.fourWay, true);
  const L = computeTouchLayout({ width: 393, height: 873, spec: pacman });
  assert.equal(L.fourWay, true);
  assert.deepEqual(L.face, []);
  for (const buttons of [1, 2, 3, 4]) {
    const big = computeTouchLayout({ width: 393, height: 873, spec: fb(buttons) });
    assert.ok(big.face.every(b => b.r * 2 >= 60), `${buttons}-button cabinets get big buttons`);
  }
});

import { adjustLayout, normalizeAdjust, layoutGroups, layoutKey, LAYOUT_SCALE } from '../src/touch-layout.js';

const inside = (box, b) => box.x >= b.x - 0.6 && box.y >= b.y - 0.6 && box.x + box.w <= b.x + b.w + 0.6 && box.y + box.h <= b.y + b.h + 0.6;

test('Tuşları yerleştir: groups move and resize, and stay on screen, in portrait never over the picture', () => {
  const sizes = [[393, 873], [360, 780], [412, 915], [768, 1024], [873, 393], [780, 360], [1024, 768]];
  for (const [width, height] of sizes) {
    for (const spec of [PAD_SPECS.nes, PAD_SPECS.snes, PAD_SPECS.md, PAD_SPECS.arcade6, PAD_SPECS.neogeo]) {
      const base = computeTouchLayout({ width, height, spec, safe: { top: 24, bottom: 20 } });
      // Pushed far in every direction and to the size limits: everything is clamped inside the bounds.
      for (const push of [-1, 1]) {
        const layout = adjustLayout(base, { dpad: { x: push, y: push, s: 9 }, face: { x: -push, y: push, s: 0.1 }, system: { x: push, y: -push } });
        for (const { group, box } of layoutGroups(layout)) {
          assert.ok(inside(box, base.bounds), `${spec.id} ${width}×${height} ${group} inside the bounds`);
          if (base.orientation === 'portrait') assert.ok(box.y >= base.screen.y + base.screen.h, `${spec.id} ${group} below the picture`);
        }
        assert.equal(layout.adjust.dpad.s, LAYOUT_SCALE.max);
        assert.equal(layout.adjust.face.s, LAYOUT_SCALE.min);
        // Applying the placement that was actually used gives the same layout again (no drift).
        const again = adjustLayout(base, layout.adjust);
        const drift = Math.max(Math.abs(again.dpad.cx - layout.dpad.cx), Math.abs(again.dpad.cy - layout.dpad.cy), Math.abs(again.face[0].cx - layout.face[0].cx), Math.abs(again.face[0].cy - layout.face[0].cy));
        assert.ok(drift <= 0.5, `${spec.id} ${width}×${height}: stored placement drifts ${drift} px`);
      }
    }
  }
});

test('Tuşları yerleştir: a placement moves the d-pad zone and the buttons\' reach with them', () => {
  const base = computeTouchLayout({ width: 393, height: 873, spec: PAD_SPECS.snes });
  const layout = adjustLayout(base, { dpad: { x: 0.05, y: -0.04, s: 1.2 }, face: { x: -0.1, y: 0.02, s: 1.25 } });
  assert.equal(layout.dpad.r, Math.round(base.dpad.r * 1.2 * 10) / 10);
  assert.deepEqual([layout.dpad.zone.cx, layout.dpad.zone.cy], [layout.dpad.cx, layout.dpad.cy]);
  assert.ok(Math.abs(layout.dpad.cx - base.dpad.cx - 0.05 * 393) < 0.6);
  assert.ok(layout.face.every((b, i) => Math.abs(b.r - base.face[i].r * 1.25) < 0.6), 'buttons resized');
  for (const b of layout.face) assert.ok(b.cx - b.r >= layout.faceArea.x && b.cx + b.r <= layout.faceArea.x + layout.faceArea.w, 'a touch on a moved button starts as a button touch');
  // No placement: the layout is RetroPlay's own.
  const plain = adjustLayout(base, null);
  assert.deepEqual([plain.dpad.cx, plain.face[0].cx, plain.system[0].x], [base.dpad.cx, base.face[0].cx, base.system[0].x]);
});

test('Tuşları yerleştir: placements are kept per pad and orientation, cleaned when read back', () => {
  assert.equal(layoutKey('snes', 'landscape'), 'snes:landscape');
  const s = normalizeTouchSettings({ layouts: {
    'nes:portrait': { dpad: { x: 0.1, y: '-0.2', s: 1.2 }, face: { s: 5 }, junk: 1 },
    'nes:landscape': { dpad: { x: 0, y: 0, s: 1 } }, // no change: not stored
    '<script>:portrait': { dpad: { x: 0.1 } },
    'snes:sideways': { dpad: { x: 0.1 } }
  } });
  assert.deepEqual(Object.keys(s.layouts), ['nes:portrait']);
  assert.deepEqual(s.layouts['nes:portrait'], { dpad: { x: 0.1, y: -0.2, s: 1.2 }, face: { x: 0, y: 0, s: LAYOUT_SCALE.max }, system: { x: 0, y: 0, s: 1 } });
  assert.deepEqual(normalizeAdjust({ system: { s: 2 } }).system, { x: 0, y: 0, s: 1 }, 'the Select/Start row only moves');
  assert.deepEqual(normalizeTouchSettings({}).layouts, {});
});

test('landscape: a group moved over the picture makes the pad see-through there', () => {
  const base = computeTouchLayout({ width: 873, height: 393, spec: PAD_SPECS.nes });
  assert.equal(base.overlay, false);
  const layout = adjustLayout(base, { face: { x: -0.2, y: 0, s: 1 } });
  assert.equal(layout.overlay, true);
  // Select and Start sit on both sides of the picture: a small move elsewhere keeps the pad solid,
  // and the editor frames the pair button by button (not across the picture).
  assert.equal(adjustLayout(base, { dpad: { x: 0.01, y: -0.05, s: 1 }, system: { y: -0.05 } }).overlay, false);
  const system = layoutGroups(base).find(g => g.group === 'system');
  assert.equal(system.parts.length, 2);
  assert.ok(system.parts.every(p => !(p.x < base.screen.x + base.screen.w && base.screen.x < p.x + p.w)), 'no frame over the picture');
});

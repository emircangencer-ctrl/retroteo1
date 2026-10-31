// Touch controller geometry and input rules (pure functions, no DOM).
//
// The on-screen pad is laid out like the console's own controller: a d-pad on the left, the face
// buttons on the right in the console's arrangement (NES B·A, Super Nintendo diamond, Mega Drive
// A·B·C under X·Y·Z, arcade 2×3 panel, Neo Geo A·B·C·D) and the shoulder/system buttons where a
// thumb finds them. Portrait: game on top, pad below (a handheld). Landscape: game in the middle,
// pad in the side areas, overlaid on the game only when the screen is too narrow.

/** Direction buttons for d-pad sectors 0..7, counter-clockwise from "right". */
const SECTOR_BUTTONS = Object.freeze([
  ['BUTTON_RIGHT'], ['BUTTON_UP', 'BUTTON_RIGHT'], ['BUTTON_UP'], ['BUTTON_UP', 'BUTTON_LEFT'],
  ['BUTTON_LEFT'], ['BUTTON_DOWN', 'BUTTON_LEFT'], ['BUTTON_DOWN'], ['BUTTON_DOWN', 'BUTTON_RIGHT']
].map(Object.freeze));
export const DIRECTION_BUTTONS = Object.freeze(['BUTTON_UP', 'BUTTON_DOWN', 'BUTTON_LEFT', 'BUTTON_RIGHT']);

/** Width in degrees of each diagonal sector (the cardinal sectors get the rest of 90°). */
export const DIAGONAL_WIDTH = Object.freeze({ az: 30, normal: 40, cok: 52 });

export const TOUCH_SETTINGS_KEY = 'retroplay-touch-settings';
export const DEFAULT_TOUCH_SETTINGS = Object.freeze({
  scale: 1,            // 0.8–1.3: size of the whole pad
  opacity: 0.8,        // 0.3–1: only where the pad lies over the game (landscape)
  haptics: true,       // short vibration on every press (Android)
  dpadMode: '8',       // '8' or '4' (4-way: no diagonals — Pac-Man, puzzle games, menus)
  diagonal: 'normal',  // az | normal | cok
  floating: false,     // the d-pad centres itself where the thumb lands
  hideWithGamepad: true,
  arcadeButtons: 'game', // 'game': only the buttons the cabinet had (FinalBurn Neo) | 'all'
  layouts: Object.freeze({}) // "Tuşları yerleştir": moved/resized groups per pad and orientation (see adjustLayout)
});

/** Groups of the pad the player can move and resize ("Tuşları yerleştir"). */
export const LAYOUT_GROUPS = Object.freeze(['dpad', 'face', 'system']);
export const LAYOUT_SCALE = Object.freeze({ min: 0.7, max: 1.5 });
const MAX_LAYOUTS = 48;
export const layoutKey = (padId, orientation) => `${padId}:${orientation}`;

/**
 * One pad's placement: per group an offset (x, y as a share of the screen's width and height, so
 * it survives small size changes such as the browser bar coming and going) and a size factor s.
 */
export function normalizeAdjust(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const group of LAYOUT_GROUPS) {
    const g = raw[group] && typeof raw[group] === 'object' ? raw[group] : {};
    const num = (v, fallback, min, max) => (Number.isFinite(Number(v)) ? clamp(Number(v), min, max) : fallback);
    out[group] = {
      x: Math.round(num(g.x, 0, -1, 1) * 10000) / 10000,
      y: Math.round(num(g.y, 0, -1, 1) * 10000) / 10000,
      s: group === 'system' ? 1 : Math.round(num(g.s, 1, LAYOUT_SCALE.min, LAYOUT_SCALE.max) * 100) / 100
    };
  }
  return out;
}
const isIdentity = a => LAYOUT_GROUPS.every(group => !a[group].x && !a[group].y && a[group].s === 1);

function normalizeLayouts(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, adjust] of Object.entries(value).slice(0, MAX_LAYOUTS)) {
    if (!/^[a-z0-9]{1,24}:(portrait|landscape)$/.test(key)) continue;
    const clean = normalizeAdjust(adjust);
    if (!isIdentity(clean)) out[key] = clean;
  }
  return out;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(value * 10) / 10;

export function normalizeTouchSettings(value = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const number = (v, fallback, min, max) => (Number.isFinite(Number(v)) ? clamp(Number(v), min, max) : fallback);
  return {
    scale: number(raw.scale, DEFAULT_TOUCH_SETTINGS.scale, 0.8, 1.3),
    opacity: number(raw.opacity, DEFAULT_TOUCH_SETTINGS.opacity, 0.3, 1),
    haptics: typeof raw.haptics === 'boolean' ? raw.haptics : DEFAULT_TOUCH_SETTINGS.haptics,
    dpadMode: raw.dpadMode === '4' ? '4' : '8',
    diagonal: Object.prototype.hasOwnProperty.call(DIAGONAL_WIDTH, raw.diagonal) ? raw.diagonal : DEFAULT_TOUCH_SETTINGS.diagonal,
    floating: typeof raw.floating === 'boolean' ? raw.floating : DEFAULT_TOUCH_SETTINGS.floating,
    hideWithGamepad: typeof raw.hideWithGamepad === 'boolean' ? raw.hideWithGamepad : DEFAULT_TOUCH_SETTINGS.hideWithGamepad,
    arcadeButtons: raw.arcadeButtons === 'all' ? 'all' : 'game',
    layouts: normalizeLayouts(raw.layouts)
  };
}

/**
 * Which of the 8 d-pad sectors a thumb offset (dx right, dy down, in px) points at, or -1 inside
 * the dead zone. Like a real d-pad that rocks on a pivot, a direction is kept until the thumb has
 * clearly moved into the next one (hysteresis), so a resting thumb never flickers between "right"
 * and "down-right".
 */
export function dpadSector(dx, dy, radius, { deadzone = 0.2, diagonal = DIAGONAL_WIDTH.normal, fourWay = false, previous = -1, hysteresis = 8 } = {}) {
  const distance = Math.hypot(dx, dy);
  const dead = radius * deadzone;
  if (distance < (previous >= 0 ? dead * 0.7 : dead)) return -1;
  let angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  const halfWidth = sector => (fourWay ? (sector % 2 ? 0 : 45) : sector % 2 ? diagonal / 2 : 45 - diagonal / 2);
  const offset = sector => Math.abs(((((angle - sector * 45) % 360) + 540) % 360) - 180);
  const within = (sector, extra) => halfWidth(sector) > 0 && offset(sector) <= halfWidth(sector) + extra;
  if (previous >= 0 && within(previous, hysteresis)) return previous;
  for (let sector = 0; sector < 8; sector++) if (within(sector, 0)) return sector;
  return previous >= 0 ? previous : Math.round(angle / 45) % 8;
}
export const sectorButtons = sector => (sector >= 0 && sector < 8 ? SECTOR_BUTTONS[sector] : []);

/**
 * Face buttons under a thumb at (x, y). Each button reacts a little beyond its drawn edge; a thumb
 * resting in the gap between two neighbours presses both (B+A, Y+B …) like a thumb laid across two
 * real buttons. Buttons: [{ cx, cy, r, … }].
 */
export function faceButtonsAt(x, y, buttons, { hit = 1.25, combo = 1.5, comboBand = 0.42 } = {}) {
  const near = [];
  for (const button of buttons) {
    const ratio = Math.hypot(x - button.cx, y - button.cy) / button.r;
    if (ratio <= combo) near.push({ button, ratio });
  }
  if (!near.length) return [];
  near.sort((a, b) => a.ratio - b.ratio);
  const [first, second] = near;
  if (second && first.ratio > 0.62 && second.ratio - first.ratio <= comboBand) return [first.button, second.button];
  return first.ratio <= hit ? [first.button] : [];
}

const button = (id, input, label, x, y, extra = {}) => Object.freeze({ id, input, label, x, y, size: 1, ...extra });
const SELECT = Object.freeze({ id: 'select', input: 'BUTTON_SELECT', label: 'SELECT', aria: 'Select' });
const START = Object.freeze({ id: 'start', input: 'BUTTON_START', label: 'START', aria: 'Start' });

/**
 * Per-console pads. Face button positions are in button diameters from the cluster centre
 * (y grows downwards); `unit` is the button diameter as a share of the screen's short side.
 */
export const PAD_SPECS = Object.freeze({
  // NES: B and A side by side, A a little higher — where the thumb rolls from B to A.
  nes: Object.freeze({
    id: 'nes', unit: 0.2,
    face: [button('b', 'BUTTON_B', 'B', -0.62, 0.14, { tone: 'nes' }), button('a', 'BUTTON_A', 'A', 0.62, -0.14, { tone: 'nes' })],
    shoulders: [], system: [SELECT, START]
  }),
  // Super Nintendo: the X/Y/A/B diamond in its colours, L and R as shoulder buttons.
  snes: Object.freeze({
    id: 'snes', unit: 0.152,
    face: [
      button('x', 'BUTTON_X', 'X', 0, -0.95, { tone: 'snes-x' }),
      button('y', 'BUTTON_Y', 'Y', -0.95, 0, { tone: 'snes-y' }),
      button('a', 'BUTTON_A', 'A', 0.95, 0, { tone: 'snes-a' }),
      button('b', 'BUTTON_B', 'B', 0, 0.95, { tone: 'snes-b' })
    ],
    shoulders: [Object.freeze({ id: 'l', input: 'BUTTON_L', label: 'L', side: 'left' }), Object.freeze({ id: 'r', input: 'BUTTON_R', label: 'R', side: 'right' })],
    system: [SELECT, START]
  }),
  // Mega Drive 6-button pad: A B C along the curve, X Y Z smaller above (Genesis Plus GX mapping:
  // A=Y, B=B, C=A, X=L, Y=X, Z=R).
  md: Object.freeze({
    id: 'md', unit: 0.15,
    face: [
      button('a', 'BUTTON_Y', 'A', -1.12, 0.46, { tone: 'md' }),
      button('b', 'BUTTON_B', 'B', 0, 0.26, { tone: 'md' }),
      button('c', 'BUTTON_A', 'C', 1.12, 0.06, { tone: 'md' }),
      button('x', 'BUTTON_L', 'X', -1.12, -0.6, { tone: 'md-small', size: 0.74 }),
      button('y', 'BUTTON_X', 'Y', 0, -0.8, { tone: 'md-small', size: 0.74 }),
      button('z', 'BUTTON_R', 'Z', 1.12, -1, { tone: 'md-small', size: 0.74 })
    ],
    shoulders: [], system: [START]
  }),
  // Arcade 2×3 panel (FinalBurn Neo / FB Alpha RetroPad layout: Y X L on top, B A R below; in
  // Street Fighter games the top row punches, the bottom row kicks).
  arcade6: Object.freeze({
    id: 'arcade6', unit: 0.145,
    face: [
      button('y', 'BUTTON_Y', '', -1.14, -0.5, { tone: 'arcade-top', aria: 'Üst sol düğme' }),
      button('x', 'BUTTON_X', '', 0, -0.64, { tone: 'arcade-top', aria: 'Üst orta düğme' }),
      button('l', 'BUTTON_L', '', 1.14, -0.56, { tone: 'arcade-top', aria: 'Üst sağ düğme' }),
      button('b', 'BUTTON_B', '', -1.14, 0.66, { tone: 'arcade-bottom', aria: 'Alt sol düğme' }),
      button('a', 'BUTTON_A', '', 0, 0.52, { tone: 'arcade-bottom', aria: 'Alt orta düğme' }),
      button('r', 'BUTTON_R', '', 1.14, 0.58, { tone: 'arcade-bottom', aria: 'Alt sağ düğme' })
    ],
    shoulders: [], system: [Object.freeze({ id: 'coin', input: 'BUTTON_SELECT', label: 'JETON', aria: 'Jeton at' }), START]
  }),
  // Neo Geo: A B C D in SNK's colours, the arc folded into two staggered rows so the buttons stay
  // thumb-sized (FinalBurn Neo: A=B, B=A, C=Y, D=X).
  neogeo: Object.freeze({
    id: 'neogeo', unit: 0.15,
    face: [
      button('a', 'BUTTON_B', 'A', -0.66, 0.56, { tone: 'neo-a' }),
      button('b', 'BUTTON_A', 'B', 0.5, 0.42, { tone: 'neo-b' }),
      button('c', 'BUTTON_Y', 'C', -0.3, -0.62, { tone: 'neo-c' }),
      button('d', 'BUTTON_X', 'D', 0.86, -0.76, { tone: 'neo-d' })
    ],
    shoulders: [], system: [Object.freeze({ id: 'coin', input: 'BUTTON_SELECT', label: 'JETON', aria: 'Jeton at' }), START]
  })
});

// Arcade cabinets with fewer than five buttons (FinalBurn Neo numbers them positionally: button 1 =
// RetroPad B, 2 = A, 3 = Y, 4 = X), so a 2-button shooter gets two big buttons instead of six.
const ARCADE_FEW = Object.freeze({
  0: [],
  1: [button('b', 'BUTTON_B', '1', 0, 0, { tone: 'arcade-bottom', size: 1.15 })],
  2: [button('b', 'BUTTON_B', '1', -0.62, 0.14, { tone: 'arcade-bottom' }), button('a', 'BUTTON_A', '2', 0.62, -0.14, { tone: 'arcade-bottom' })],
  3: [button('b', 'BUTTON_B', '1', -0.62, 0.56, { tone: 'arcade-bottom' }), button('a', 'BUTTON_A', '2', 0.62, 0.42, { tone: 'arcade-bottom' }), button('y', 'BUTTON_Y', '3', -0.62, -0.6, { tone: 'arcade-top' })],
  4: [button('y', 'BUTTON_Y', '3', -0.62, -0.58, { tone: 'arcade-top' }), button('x', 'BUTTON_X', '4', 0.62, -0.72, { tone: 'arcade-top' }), button('b', 'BUTTON_B', '1', -0.62, 0.58, { tone: 'arcade-bottom' }), button('a', 'BUTTON_A', '2', 0.62, 0.44, { tone: 'arcade-bottom' })]
});
const ARCADE_FEW_UNIT = Object.freeze({ 0: 0.2, 1: 0.21, 2: 0.19, 3: 0.17, 4: 0.165 });

/**
 * The pad for a library platform. Arcade: arcadeLayout 'neogeo' | 'six'; `arcade` = { core, buttons,
 * ways } from the cabinet's controls: FinalBurn Neo games get only their buttons (unless
 * settings.arcadeButtons is 'all'), 4-way joystick games (Pac-Man, Donkey Kong) a 4-way d-pad.
 */
export function padSpecFor(platform, arcadeLayout = 'six', arcade = null, settings = DEFAULT_TOUCH_SETTINGS) {
  if (platform === 'NES') return PAD_SPECS.nes;
  if (platform === 'SNES') return PAD_SPECS.snes;
  if (platform === 'MD') return PAD_SPECS.md;
  if (platform !== 'ARCADE') return PAD_SPECS.nes;
  const base = arcadeLayout === 'neogeo' ? PAD_SPECS.neogeo : PAD_SPECS.arcade6;
  const fourWay = arcade?.ways === 4;
  const buttons = Number.isInteger(arcade?.buttons) ? arcade.buttons : null;
  const few = base === PAD_SPECS.arcade6 && arcade?.core === 'fbneo' && normalizeTouchSettings(settings).arcadeButtons !== 'all' && buttons !== null && buttons <= 4;
  if (!few && !fourWay) return base;
  return Object.freeze({ ...base, ...(few ? { id: `arcade${buttons}`, unit: ARCADE_FEW_UNIT[buttons], face: ARCADE_FEW[buttons] } : {}), fourWay });
}

function clusterBox(face) {
  if (!face.length) return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, w: 1, h: 1 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of face) {
    const half = (b.size || 1) / 2;
    minX = Math.min(minX, b.x - half); maxX = Math.max(maxX, b.x + half);
    minY = Math.min(minY, b.y - half); maxY = Math.max(maxY, b.y + half);
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function placeFace(spec, d, rightEdge, centreY) {
  const box = clusterBox(spec.face);
  const ox = rightEdge - box.maxX * d;
  const oy = centreY - ((box.minY + box.maxY) / 2) * d;
  return spec.face.map(b => ({ id: b.id, input: b.input, label: b.label, tone: b.tone || '', aria: b.aria || b.label, cx: round(ox + b.x * d), cy: round(oy + b.y * d), r: round((d * (b.size || 1)) / 2) }));
}

/**
 * Where everything goes. Returns (CSS px, relative to the player): screen rect, d-pad (centre,
 * radius, zone the thumb may start in), face buttons, shoulder and system buttons, chrome
 * positions and whether the pad overlaps the game.
 */
export function computeTouchLayout({ width, height, safe = {}, aspect = 4 / 3, spec = PAD_SPECS.nes, settings = DEFAULT_TOUCH_SETTINGS, padHidden = false } = {}) {
  const W = Math.max(200, width), H = Math.max(200, height);
  const s = normalizeTouchSettings(settings);
  const inset = { top: safe.top || 0, right: safe.right || 0, bottom: safe.bottom || 0, left: safe.left || 0 };
  const layout = W > H * 1.05 ? landscape(W, H, inset, aspect, spec, s) : portrait(W, H, inset, aspect, spec, s);
  if (padHidden && layout.orientation === 'portrait') {
    // A controller is in use and the pad is hidden: the picture takes the whole screen.
    const top = layout.screen.y, room = H - inset.bottom - top;
    let sw = W, sh = Math.round(W / aspect);
    if (sh > room) { sh = room; sw = Math.round(sh * aspect); }
    layout.screen = { x: Math.round((W - sw) / 2), y: Math.round(top + (room - sh) / 2), w: sw, h: sh };
  }
  return { ...layout, padHidden: Boolean(padHidden), fourWay: Boolean(spec.fourWay) };
}

function systemButtons(spec, positions) {
  return spec.system.map((b, i) => ({ id: b.id, input: b.input, label: b.label, aria: b.aria || b.label, ...positions[i] }));
}

function portrait(W, H, inset, aspect, spec, s) {
  const barH = 48 + inset.top;
  let sw = W, sh = Math.round(W / aspect);
  const maxSh = Math.round((H - barH) * 0.5);
  if (sh > maxSh) { sh = maxSh; sw = Math.round(sh * aspect); }
  const screen = { x: Math.round((W - sw) / 2), y: barH, w: sw, h: sh };
  const top = screen.y + sh + 10;
  const bottom = H - inset.bottom - 10;
  const margin = Math.max(16, Math.round(W * 0.05));
  const shoulderH = spec.shoulders.length ? 40 : 0;
  const systemH = 34;
  const bandTop = top + (shoulderH ? shoulderH + 16 : 6);
  const bandBottom = bottom - systemH - 18;
  const bandH = Math.max(80, bandBottom - bandTop);
  const half = W / 2;
  const D = clamp(Math.min(W * 0.41 * s.scale, half - margin - 6, bandH), 96, 220);
  const cy = round(bandTop + bandH / 2);
  const dpad = { cx: round(inset.left + margin + D / 2), cy, r: round(D / 2) };
  const box = clusterBox(spec.face);
  const d = Math.min(W * spec.unit * s.scale, 96 * s.scale, (W - half - margin - 8) / box.w, bandH / box.h);
  const face = placeFace(spec, d, W - inset.right - margin, cy);
  const shoulderW = Math.round(Math.min(W * 0.32, 150));
  const clusterTop = Math.min(dpad.cy - dpad.r, ...face.map(b => b.cy - b.r));
  const shoulderY = Math.round(Math.max(top + 4, clusterTop - 18 - shoulderH));
  const shoulders = spec.shoulders.map(b => ({ id: b.id, input: b.input, label: b.label, aria: b.label,
    x: b.side === 'left' ? inset.left + margin : W - inset.right - margin - shoulderW, y: shoulderY, w: shoulderW, h: shoulderH }));
  const sysW = 78, gap = 22, count = spec.system.length;
  const rowW = count * sysW + (count - 1) * gap;
  const clusterBottom = Math.max(dpad.cy + dpad.r, ...face.map(b => b.cy + b.r));
  const systemY = Math.round(Math.min(bottom - systemH, clusterBottom + 30));
  const system = systemButtons(spec, spec.system.map((_, i) => ({ x: Math.round((W - rowW) / 2 + i * (sysW + gap)), y: systemY, w: sysW, h: systemH })));
  return {
    orientation: 'portrait', overlay: false, width: W, height: H, screen,
    // Where a moved group may go: below the picture, inside the safe area.
    bounds: { x: inset.left + 6, y: top, w: W - inset.left - inset.right - 12, h: H - inset.bottom - 6 - top },
    dpad: { ...dpad, zone: { cx: dpad.cx, cy: dpad.cy, r: round(dpad.r * 1.75) }, area: { x: 0, y: top, w: half, h: bottom - top } },
    face, faceArea: { x: half, y: top, w: W - half, h: bottom - top },
    shoulders, system,
    chrome: { bar: { x: 0, y: 0, w: W, h: barH, padTop: inset.top } }
  };
}

function landscape(W, H, inset, aspect, spec, s) {
  const usableH = H - inset.top - inset.bottom;
  let sh = usableH, sw = Math.round(sh * aspect);
  if (sw > W * 0.64) { sw = Math.round(W * 0.64); sh = Math.round(sw / aspect); }
  const screen = { x: Math.round((W - sw) / 2), y: Math.round(inset.top + (usableH - sh) / 2), w: sw, h: sh };
  const side = screen.x;
  const margin = 16;
  const box = clusterBox(spec.face);
  const room = side - Math.max(inset.left, inset.right) - margin * 2;
  let D = clamp(Math.min(usableH * 0.42, Math.max(room, usableH * 0.34)) * s.scale, 96, 210);
  const preferred = Math.min(usableH * spec.unit * s.scale, 96 * s.scale, (usableH * 0.5) / box.h);
  const thumb = 52 * s.scale;
  const fit = room / box.w;
  // Fit the buttons beside the picture; only when that would make them smaller than a thumb do they
  // reach a little (up to ~24 px) over the picture's edge.
  const d = fit >= thumb ? Math.min(preferred, fit) : Math.min(preferred, Math.max(thumb, (room + 24 * s.scale) / box.w));
  const overlay = D > room + 2 || d * box.w > room + 2;
  const systemH = 30;
  const topChrome = inset.top + 56;
  const shoulderH = spec.shoulders.length ? 36 : 0;
  const minCy = topChrome + shoulderH + (shoulderH ? 12 : 0) + Math.max(D / 2, (d * box.h) / 2);
  const maxCy = H - inset.bottom - systemH - 16 - Math.max(D / 2, (d * box.h) / 2);
  const cy = round(clamp(inset.top + usableH * 0.6, Math.min(minCy, maxCy), Math.max(minCy, maxCy)));
  const leftSpace = Math.max(margin, (side - inset.left - D) / 2);
  const dpad = { cx: round(inset.left + leftSpace + D / 2), cy, r: round(D / 2) };
  const clusterW = d * box.w;
  const rightSpace = Math.max(margin, (side - inset.right - clusterW) / 2);
  const face = placeFace(spec, d, W - inset.right - rightSpace, cy);
  const shoulderW = Math.round(clamp(side - inset.left - margin * 2, 96, 132));
  const shoulders = spec.shoulders.map(b => ({ id: b.id, input: b.input, label: b.label, aria: b.label,
    x: b.side === 'left' ? inset.left + margin : W - inset.right - margin - shoulderW, y: topChrome, w: shoulderW, h: shoulderH }));
  const sysW = 72, y = H - inset.bottom - systemH - 10;
  let positions;
  if (side - Math.max(inset.left, inset.right) >= sysW + margin * 2) {
    // SELECT/COIN under the d-pad side, START under the buttons, both towards the middle.
    positions = spec.system.map(b => (b.id === 'start'
      ? { x: W - side + margin, y, w: sysW, h: systemH }
      : { x: side - margin - sysW, y, w: sysW, h: systemH }));
  } else {
    const gap = 18, rowW = spec.system.length * sysW + (spec.system.length - 1) * gap;
    positions = spec.system.map((_, i) => ({ x: Math.round((W - rowW) / 2 + i * (sysW + gap)), y, w: sysW, h: systemH }));
  }
  return {
    orientation: 'landscape', overlay, width: W, height: H, screen,
    bounds: { x: inset.left + 6, y: topChrome, w: W - inset.left - inset.right - 12, h: H - inset.bottom - 6 - topChrome },
    dpad: { ...dpad, zone: { cx: dpad.cx, cy: dpad.cy, r: round(dpad.r * 1.75) }, area: { x: 0, y: topChrome, w: Math.max(side, W * 0.3), h: H - topChrome } },
    face, faceArea: { x: Math.min(W - side, W * 0.7), y: topChrome, w: W - Math.min(W - side, W * 0.7), h: H - topChrome },
    shoulders, system: systemButtons(spec, positions),
    chrome: { bar: { x: 0, y: 0, w: W, h: 0, padTop: inset.top } }
  };
}


const boxOf = items => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of items) {
    if ('r' in b) { x0 = Math.min(x0, b.cx - b.r); y0 = Math.min(y0, b.cy - b.r); x1 = Math.max(x1, b.cx + b.r); y1 = Math.max(y1, b.cy + b.r); }
    else { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
/** How far (px) a box at `box` may move by `d` along one axis and stay within [lo, hi]. */
const keepInside = (start, size, d, lo, hi) => (size > hi - lo ? lo + (hi - lo - size) / 2 - start : clamp(start + d, lo, hi - size) - start);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The layout with the player's own placement ("Tuşları yerleştir") applied: the d-pad, the face
 * buttons and the Select/Start row moved and (d-pad, buttons) resized, kept inside `layout.bounds`
 * (in portrait never over the picture). Returns the new layout with `adjust` set to the placement
 * that was actually used (a group pushed against an edge stops there).
 */
export function adjustLayout(layout, adjust) {
  if (!adjust || !layout.bounds) return { ...layout, adjust: normalizeAdjust(null) };
  const a = normalizeAdjust(adjust);
  const { width: W, height: H, bounds: B } = layout;
  const used = normalizeAdjust(null);
  // D-pad
  const d = layout.dpad, r = round(d.r * a.dpad.s);
  const dx = keepInside(d.cx - r, r * 2, a.dpad.x * W, B.x, B.x + B.w);
  const dy = keepInside(d.cy - r, r * 2, a.dpad.y * H, B.y, B.y + B.h);
  const dpad = { ...d, cx: round(d.cx + dx), cy: round(d.cy + dy), r, zone: { cx: round(d.cx + dx), cy: round(d.cy + dy), r: round(r * 1.75) } };
  used.dpad = { x: dx / W, y: dy / H, s: a.dpad.s };
  // Face buttons: resized around the cluster's centre, then moved.
  let face = layout.face, faceArea = layout.faceArea;
  if (face.length) {
    const box = boxOf(face), fx = box.x + box.w / 2, fy = box.y + box.h / 2, k = a.face.s;
    const sized = face.map(b => ({ ...b, cx: fx + (b.cx - fx) * k, cy: fy + (b.cy - fy) * k, r: b.r * k }));
    const sbox = boxOf(sized);
    const mx = keepInside(sbox.x, sbox.w, a.face.x * W, B.x, B.x + B.w);
    const my = keepInside(sbox.y, sbox.h, a.face.y * H, B.y, B.y + B.h);
    face = sized.map(b => ({ ...b, cx: round(b.cx + mx), cy: round(b.cy + my), r: round(b.r) }));
    used.face = { x: mx / W, y: my / H, s: k };
    // A touch that starts near the buttons belongs to them, wherever they are now.
    const reach = Math.max(...face.map(b => b.r)) * 0.9;
    const near = { x: sbox.x + mx - reach, y: sbox.y + my - reach, w: sbox.w + reach * 2, h: sbox.h + reach * 2 };
    const x0 = Math.min(faceArea.x, near.x), y0 = Math.min(faceArea.y, near.y);
    faceArea = { x: x0, y: y0, w: Math.max(faceArea.x + faceArea.w, near.x + near.w) - x0, h: Math.max(faceArea.y + faceArea.h, near.y + near.h) - y0 };
  }
  // Select / Start row
  let system = layout.system;
  if (system.length) {
    const box = boxOf(system);
    const sx = keepInside(box.x, box.w, a.system.x * W, B.x, B.x + B.w);
    const sy = keepInside(box.y, box.h, a.system.y * H, B.y, B.y + B.h);
    system = system.map(b => ({ ...b, x: Math.round(b.x + sx), y: Math.round(b.y + sy) }));
    used.system = { x: sx / W, y: sy / H, s: 1 };
  }
  // Each part on its own (the landscape Select/Start pair sits on both sides of the picture).
  const parts = [{ x: dpad.cx - dpad.r, y: dpad.cy - dpad.r, w: dpad.r * 2, h: dpad.r * 2 }, ...face.map(b => boxOf([b])), ...system.map(b => boxOf([b]))];
  const overlay = layout.orientation === 'landscape' && (layout.overlay || parts.some(g => overlaps(g, layout.screen)));
  for (const group of LAYOUT_GROUPS) { used[group].x = Math.round(used[group].x * 10000) / 10000; used[group].y = Math.round(used[group].y * 10000) / 10000; }
  return { ...layout, dpad, face, faceArea, system, overlay, adjust: used };
}

/**
 * The groups the player can move (for the editor), in layout px: `box` around the whole group and
 * `parts`, the boxes to frame and to take it by (the Select/Start pair, which sits on both sides of
 * the picture in landscape, is framed button by button when they are far apart).
 */
export function layoutGroups(layout) {
  const out = [];
  const d = layout.dpad;
  const dbox = { x: d.cx - d.r, y: d.cy - d.r, w: d.r * 2, h: d.r * 2 };
  out.push({ group: 'dpad', box: dbox, parts: [dbox] });
  if (layout.face.length) { const box = boxOf(layout.face); out.push({ group: 'face', box, parts: [box] }); }
  if (layout.system.length) {
    const box = boxOf(layout.system);
    const apart = box.w > layout.system.reduce((sum, b) => sum + b.w, 0) * 2;
    out.push({ group: 'system', box, parts: apart ? layout.system.map(b => boxOf([b])) : [box] });
  }
  return out;
}

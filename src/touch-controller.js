// On-screen pad (DOM + pointer handling). Geometry and input rules live in touch-layout.js.
//
// Feel of a real pad:
// - The d-pad is one surface: the thumb rolls between all 8 directions without lifting, may slide
//   past the drawn cross, and a direction holds steady at sector edges (hysteresis).
// - Face buttons react a little beyond their edge; sliding from one to another switches the press;
//   a thumb laid between two presses both.
// - Every finger is tracked on its own (d-pad + two buttons at once), presses act on touch-down,
//   and each new press gives a short vibration where the phone supports it.
import { dpadSector, sectorButtons, faceButtonsAt, DIAGONAL_WIDTH, normalizeTouchSettings } from './touch-layout.js';

const DPAD_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
<defs><linearGradient id="tc-cross" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4558"/><stop offset="1" stop-color="#1c2330"/></linearGradient></defs>
<circle class="tc-well" cx="50" cy="50" r="49"/>
<g class="tc-cross"><rect x="33" y="5" width="34" height="90" rx="8"/><rect x="5" y="33" width="90" height="34" rx="8"/></g>
<rect class="tc-arm" data-dir="BUTTON_UP" x="33" y="5" width="34" height="32" rx="8"/>
<rect class="tc-arm" data-dir="BUTTON_DOWN" x="33" y="63" width="34" height="32" rx="8"/>
<rect class="tc-arm" data-dir="BUTTON_LEFT" x="5" y="33" width="32" height="34" rx="8"/>
<rect class="tc-arm" data-dir="BUTTON_RIGHT" x="63" y="33" width="32" height="34" rx="8"/>
<circle class="tc-hub" cx="50" cy="50" r="10"/>
<path class="tc-arrow" d="M50 13 l7 9 h-14z"/><path class="tc-arrow" d="M50 87 l7 -9 h-14z"/>
<path class="tc-arrow" d="M13 50 l9 -7 v14z"/><path class="tc-arrow" d="M87 50 l-9 -7 v14z"/>
</svg>`;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const px = value => `${Math.round(value * 10) / 10}px`;
const inRect = (x, y, r, slop = 0) => x >= r.x - slop && x <= r.x + r.w + slop && y >= r.y - slop && y <= r.y + r.h + slop;

export class TouchController {
  /**
   * press(input) / release(input): RetroPad button names. vibrate(ms): navigator.vibrate or null.
   */
  constructor(root, { press, release, vibrate = null, now = () => performance.now() } = {}) {
    this.root = root;
    this.press = press || (() => {});
    this.release = release || (() => {});
    this.vibrate = vibrate;
    this.now = now;
    this.layout = null;
    this.settings = normalizeTouchSettings();
    this.pointers = new Map();
    this.held = new Set();
    this.lastBuzz = -Infinity;
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', this.onUp);
    root.addEventListener('lostpointercapture', this.onUp);
    root.addEventListener('contextmenu', event => event.preventDefault());
  }

  setSettings(settings) { this.settings = normalizeTouchSettings(settings); }

  /** Draws the pad for a layout from computeTouchLayout(). */
  render(layout) {
    this.releaseAll();
    this.layout = layout;
    const root = this.root;
    root.dataset.orientation = layout.orientation;
    root.dataset.fourWay = String(Boolean(layout.fourWay));
    root.classList.toggle('is-overlay', Boolean(layout.overlay));
    root.style.setProperty('--tc-opacity', String(layout.overlay ? this.settings.opacity : 1));
    const { dpad } = layout;
    const parts = [`<div class="tc-dpad" style="left:${px(dpad.cx - dpad.r)};top:${px(dpad.cy - dpad.r)};width:${px(dpad.r * 2)};height:${px(dpad.r * 2)}">${DPAD_SVG}</div>`];
    for (const b of layout.face) {
      parts.push(`<div class="tc-btn tc-face" data-input="${esc(b.input)}" data-tone="${esc(b.tone)}" role="img" aria-label="${esc(b.aria)}" style="left:${px(b.cx - b.r)};top:${px(b.cy - b.r)};width:${px(b.r * 2)};height:${px(b.r * 2)};font-size:${px(Math.max(13, b.r * 0.62))}"><span>${esc(b.label)}</span></div>`);
    }
    for (const b of layout.shoulders) {
      parts.push(`<div class="tc-btn tc-shoulder tc-${esc(b.id)}" data-input="${esc(b.input)}" role="img" aria-label="${esc(b.aria)}" style="left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)}"><span>${esc(b.label)}</span></div>`);
    }
    for (const b of layout.system) {
      parts.push(`<div class="tc-btn tc-system" data-input="${esc(b.input)}" role="img" aria-label="${esc(b.aria)}" style="left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)}"><span>${esc(b.label)}</span></div>`);
    }
    root.innerHTML = parts.join('');
    this.dpadEl = root.querySelector('.tc-dpad');
    this.arms = [...root.querySelectorAll('.tc-arm')];
    this.buttonEls = [...root.querySelectorAll('.tc-btn')];
  }

  point(event) {
    const box = this.root.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  /** What a touch starting at (x, y) controls. */
  targetAt(x, y) {
    const L = this.layout;
    if (!L) return null;
    for (const b of L.system) if (inRect(x, y, b, 12)) return { kind: 'button', button: b };
    for (const b of L.shoulders) if (inRect(x, y, b, 14)) return { kind: 'button', button: b };
    const z = L.dpad.zone;
    if (this.settings.floating ? inRect(x, y, L.dpad.area) : Math.hypot(x - z.cx, y - z.cy) <= z.r) return { kind: 'dpad' };
    if (inRect(x, y, L.faceArea)) return { kind: 'face' };
    return null;
  }

  onDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const { x, y } = this.point(event);
    const target = this.targetAt(x, y);
    event.preventDefault();
    if (!target) return;
    try { this.root.setPointerCapture(event.pointerId); } catch {}
    const p = { id: event.pointerId, ...target, x, y, sector: -1, inputs: [] };
    if (target.kind === 'dpad') {
      const L = this.layout;
      p.cx = L.dpad.cx; p.cy = L.dpad.cy;
      if (this.settings.floating) {
        // The pad comes to the thumb (kept inside its area).
        const a = L.dpad.area, r = L.dpad.r;
        p.cx = Math.min(a.x + a.w - r * 0.6, Math.max(a.x + r * 0.6, x));
        p.cy = Math.min(a.y + a.h - r * 0.6, Math.max(a.y + r * 0.6, y));
        if (this.dpadEl) { this.dpadEl.style.left = px(p.cx - r); this.dpadEl.style.top = px(p.cy - r); }
      }
    }
    this.pointers.set(event.pointerId, p);
    this.update(p);
    this.commit();
  }

  onMove(event) {
    const p = this.pointers.get(event.pointerId);
    if (!p) return;
    event.preventDefault();
    const { x, y } = this.point(event);
    p.x = x; p.y = y;
    this.update(p);
    this.commit();
  }

  onUp(event) {
    const p = this.pointers.get(event.pointerId);
    if (!p) return;
    this.pointers.delete(event.pointerId);
    if (p.kind === 'dpad' && this.settings.floating && this.dpadEl && this.layout && ![...this.pointers.values()].some(other => other.kind === 'dpad')) {
      this.dpadEl.style.left = px(this.layout.dpad.cx - this.layout.dpad.r);
      this.dpadEl.style.top = px(this.layout.dpad.cy - this.layout.dpad.r);
    }
    this.commit();
  }

  update(p) {
    const L = this.layout;
    if (!L) { p.inputs = []; return; }
    if (p.kind === 'dpad') {
      p.sector = dpadSector(p.x - p.cx, p.y - p.cy, L.dpad.r, {
        diagonal: DIAGONAL_WIDTH[this.settings.diagonal], fourWay: this.settings.dpadMode === '4' || Boolean(L.fourWay), previous: p.sector
      });
      p.inputs = sectorButtons(p.sector);
    } else if (p.kind === 'face') {
      p.inputs = [...new Set(faceButtonsAt(p.x, p.y, L.face).map(b => b.input))];
    } else if (p.kind === 'button') {
      p.inputs = inRect(p.x, p.y, p.button, 18) ? [p.button.input] : [];
    }
  }

  /** Applies the union of all fingers' presses: press new ones, release lifted ones. */
  commit() {
    const want = new Set();
    for (const p of this.pointers.values()) for (const input of p.inputs) want.add(input);
    let buzz = 0;
    for (const input of want) {
      if (this.held.has(input)) continue;
      this.held.add(input);
      this.press(input);
      buzz = Math.max(buzz, input.startsWith('BUTTON_UP') || input.startsWith('BUTTON_DOWN') || input.startsWith('BUTTON_LEFT') || input.startsWith('BUTTON_RIGHT') ? 8 : 14);
    }
    for (const input of [...this.held]) {
      if (want.has(input)) continue;
      this.held.delete(input);
      this.release(input);
    }
    if (buzz && this.settings.haptics && this.vibrate) {
      const t = this.now();
      if (t - this.lastBuzz > 24) { this.lastBuzz = t; try { this.vibrate(buzz); } catch {} }
    }
    this.paint();
  }

  paint() {
    for (const arm of this.arms || []) arm.classList.toggle('is-on', this.held.has(arm.dataset.dir));
    for (const el of this.buttonEls || []) el.classList.toggle('is-on', this.held.has(el.dataset.input));
    if (this.dpadEl) {
      // The cross rocks towards the pressed direction, like a real d-pad on its pivot.
      const tiltX = (this.held.has('BUTTON_UP') ? 1 : 0) - (this.held.has('BUTTON_DOWN') ? 1 : 0);
      const tiltY = (this.held.has('BUTTON_RIGHT') ? 1 : 0) - (this.held.has('BUTTON_LEFT') ? 1 : 0);
      this.dpadEl.classList.toggle('is-on', Boolean(tiltX || tiltY));
      this.dpadEl.style.transform = tiltX || tiltY ? `perspective(420px) rotateX(${tiltX * 10}deg) rotateY(${tiltY * 10}deg)` : '';
    }
  }

  /** Lifts every finger (menu opened, app hidden, screen rotated). */
  releaseAll() {
    this.pointers.clear();
    for (const input of this.held) this.release(input);
    this.held.clear();
    if (this.dpadEl && this.layout) {
      this.dpadEl.style.left = px(this.layout.dpad.cx - this.layout.dpad.r);
      this.dpadEl.style.top = px(this.layout.dpad.cy - this.layout.dpad.r);
    }
    this.paint();
  }
}

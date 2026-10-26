// Physical controllers (USB / Bluetooth) through the browser Gamepad API.
//
// Buttons are mapped by position, the way RetroArch maps a "standard" controller onto its
// RetroPad: the bottom face button is RetroPad B, the right one A, left Y, top X. Every core then
// applies its own console layout (NES B·A, Super Nintendo diamond, Mega Drive A·B·C …), so a
// controller feels like the original pad whatever letters are printed on it. The left stick
// works as a d-pad. EmulatorJS's own gamepad handling is switched off in the player so a press is
// never delivered twice.
import { dpadSector, sectorButtons } from './touch-layout.js';

/** W3C "standard" gamepad button index → RetroPad button. */
export const STANDARD_TO_RETROPAD = Object.freeze({
  0: 'BUTTON_B', 1: 'BUTTON_A', 2: 'BUTTON_Y', 3: 'BUTTON_X',
  4: 'BUTTON_L', 5: 'BUTTON_R', 6: 'BUTTON_L2', 7: 'BUTTON_R2',
  8: 'BUTTON_SELECT', 9: 'BUTTON_START', 10: 'BUTTON_L3', 11: 'BUTTON_R3',
  12: 'BUTTON_UP', 13: 'BUTTON_DOWN', 14: 'BUTTON_LEFT', 15: 'BUTTON_RIGHT'
});
/** The centre "home / guide" button opens the player menu. */
export const MENU_BUTTON_INDEX = 16;

const isDown = button => Boolean(button && (button.pressed || (typeof button.value === 'number' && button.value > 0.5)));

/**
 * Hat switch on axis 9 (controllers Chrome does not map as "standard"): -1 up, then clockwise in
 * steps of 2/7; values above 1 mean centred.
 */
function hatButtons(value) {
  if (typeof value !== 'number' || value > 1.05 || value < -1.05) return [];
  const step = Math.round(((value + 1) * 7) / 2); // 0 up, 1 up-right, … 7 up-left
  return [['BUTTON_UP'], ['BUTTON_UP', 'BUTTON_RIGHT'], ['BUTTON_RIGHT'], ['BUTTON_DOWN', 'BUTTON_RIGHT'], ['BUTTON_DOWN'], ['BUTTON_DOWN', 'BUTTON_LEFT'], ['BUTTON_LEFT'], ['BUTTON_UP', 'BUTTON_LEFT']][step] || [];
}

/**
 * RetroPad buttons held on one controller. `previousSector` keeps the stick's direction stable at
 * sector edges. Returns { buttons: Set, sector, menu, active }.
 */
export function readGamepad(pad, { deadzone = 0.45, previousSector = -1 } = {}) {
  const buttons = new Set();
  if (!pad || pad.connected === false) return { buttons, sector: -1, menu: false, active: false };
  const list = pad.buttons || [];
  for (let i = 0; i < list.length && i < 16; i++) if (isDown(list[i])) buttons.add(STANDARD_TO_RETROPAD[i]);
  const axes = pad.axes || [];
  const x = Number(axes[0]) || 0, y = Number(axes[1]) || 0;
  const sector = dpadSector(x, y, 1, { deadzone, diagonal: 45, previous: previousSector, hysteresis: 6 });
  for (const name of sectorButtons(sector)) buttons.add(name);
  if (pad.mapping !== 'standard' && axes.length > 9) for (const name of hatButtons(axes[9])) buttons.add(name);
  const menu = isDown(list[MENU_BUTTON_INDEX]);
  return { buttons, sector, menu, active: buttons.size > 0 || menu };
}

/** Pressing Select and Start together (within this time) opens the menu instead of reaching the game. */
export const MENU_COMBO_MS = 90;
const SYSTEM_BUTTONS = Object.freeze(['BUTTON_SELECT', 'BUTTON_START']);

/**
 * Polls connected controllers once per frame while a game runs and reports changes:
 * onChange(pressed[], released[]), onActivity() when a controller is used, onMenu() on the guide
 * button or on Select+Start together (many Android controllers have no guide button the browser
 * can see). Select and Start alone reach the game MENU_COMBO_MS later, so the combination never
 * presses them in the game. Buttons already held when polling starts (for example the one that
 * closed the menu) are ignored until released. All connected controllers act as player 1.
 */
export class GamepadPoller {
  constructor({ getGamepads = () => (globalThis.navigator?.getGamepads ? [...navigator.getGamepads()] : []), onChange, onActivity, onMenu, requestFrame, cancelFrame, now } = {}) {
    this.getGamepads = getGamepads;
    this.onChange = onChange || (() => {});
    this.onActivity = onActivity || (() => {});
    this.onMenu = onMenu || (() => {});
    this.requestFrame = requestFrame || (cb => globalThis.requestAnimationFrame(cb));
    this.cancelFrame = cancelFrame || (id => globalThis.cancelAnimationFrame(id));
    this.held = new Set();
    this.sectors = new Map();
    this.menuDown = false;
    this.now = now || (() => globalThis.performance.now());
    this.ignored = new Set();
    this.deferredSince = new Map();
    this.comboDown = false;
    this.primePending = false;
    this.frame = 0;
    this.running = false;
    this.tick = () => { this.frame = 0; if (!this.running) return; this.poll(); if (this.running && !this.frame) this.frame = this.requestFrame(this.tick); };
  }
  start() { if (this.running) return; this.running = true; this.primePending = true; if (!this.frame) this.frame = this.requestFrame(this.tick); }
  stop() {
    this.running = false;
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
    this.releaseAll();
  }
  releaseAll() {
    if (this.held.size) this.onChange([], [...this.held]);
    this.held.clear();
    this.sectors.clear();
    this.menuDown = false;
    this.deferredSince.clear();
  }
  poll() {
    let pads = [];
    try { pads = (this.getGamepads() || []).filter(Boolean); } catch { pads = []; }
    const raw = new Set();
    let active = false, menu = false;
    for (const pad of pads) {
      const state = readGamepad(pad, { previousSector: this.sectors.get(pad.index) ?? -1 });
      this.sectors.set(pad.index, state.sector);
      for (const name of state.buttons) raw.add(name);
      active = active || state.active;
      menu = menu || state.menu;
    }
    const t = this.now();
    if (this.primePending) {
      this.primePending = false;
      for (const name of raw) this.ignored.add(name);
      this.menuDown = menu;
      this.comboDown = raw.has('BUTTON_SELECT') && raw.has('BUTTON_START');
    }
    for (const name of [...this.ignored]) if (!raw.has(name)) this.ignored.delete(name);
    // Select + Start together: the menu, and neither button reaches the game.
    const combo = raw.has('BUTTON_SELECT') && raw.has('BUTTON_START');
    let comboEdge = false;
    if (combo && !this.comboDown) {
      comboEdge = true;
      for (const name of SYSTEM_BUTTONS) { this.ignored.add(name); this.deferredSince.delete(name); }
    }
    this.comboDown = combo;
    const effective = new Set([...raw].filter(name => !this.ignored.has(name)));
    for (const name of SYSTEM_BUTTONS) {
      if (this.held.has(name)) { this.deferredSince.delete(name); continue; }
      if (effective.has(name)) {
        // A new press of Select or Start waits a moment for the other one.
        if (!this.deferredSince.has(name)) this.deferredSince.set(name, t);
        if (t - this.deferredSince.get(name) < MENU_COMBO_MS) effective.delete(name);
        else this.deferredSince.delete(name);
      } else if (this.deferredSince.has(name)) {
        // Tapped and let go before it was delivered: press it now, the release follows next frame.
        this.deferredSince.delete(name);
        if (!this.ignored.has(name)) effective.add(name);
      }
    }
    const pressed = [...effective].filter(name => !this.held.has(name));
    const released = [...this.held].filter(name => !effective.has(name));
    this.held = effective;
    if (pressed.length || released.length) this.onChange(pressed, released);
    if (active) this.onActivity();
    if ((menu && !this.menuDown) || comboEdge) this.onMenu();
    this.menuDown = menu;
    return { pressed, released };
  }
}

// Physical controllers (USB / Bluetooth) through the browser Gamepad API.
//
// Buttons are mapped by position, the way RetroArch maps a "standard" controller onto its
// RetroPad: the bottom face button is RetroPad B, the right one A, left Y, top X. Every core then
// applies its own console layout (NES B·A, Super Nintendo diamond, Mega Drive A·B·C …), so a
// controller feels like the original pad whatever letters are printed on it. The left stick
// works as a d-pad. EmulatorJS's own gamepad handling is switched off in the player so a press is
// never delivered twice. Each controller plays as its own player (see players.js).
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

/**
 * Speed shortcuts on a controller (consoles): R2 switches fast forward on and off, L2 held runs
 * the game backwards. Arcade boards keep L2/R2 for the game (MAME and FinalBurn Neo map extra
 * buttons there). Returns 'fastForward' | 'rewind' | null.
 */
export function speedShortcut(name, { arcade = false } = {}) {
  if (arcade) return null;
  if (name === 'BUTTON_R2') return 'fastForward';
  if (name === 'BUTTON_L2') return 'rewind';
  return null;
}

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
 * Polls connected controllers once per frame while a game runs and reports changes per player:
 * onChange(pressed[], released[], player), onActivity(player) when a controller is used, onMenu()
 * on the guide button or on Select+Start together (many Android controllers have no guide button
 * the browser can see). playerFor(pad, active) says which player a controller plays as (0 = player
 * 1); null leaves a controller out (one that has not been used yet). Controllers of the same player
 * are combined. Select and Start alone reach the game MENU_COMBO_MS later, so the combination
 * never presses them in the game. Buttons already held when polling starts (for example the one
 * that closed the menu) are ignored until released. Without playerFor every controller is player 1.
 */
export class GamepadPoller {
  constructor({ getGamepads = () => (globalThis.navigator?.getGamepads ? [...navigator.getGamepads()] : []), onChange, onActivity, onMenu, playerFor, requestFrame, cancelFrame, now } = {}) {
    this.getGamepads = getGamepads;
    this.onChange = onChange || (() => {});
    this.onActivity = onActivity || (() => {});
    this.onMenu = onMenu || (() => {});
    this.playerFor = playerFor || (() => 0);
    this.requestFrame = requestFrame || (cb => globalThis.requestAnimationFrame(cb));
    this.cancelFrame = cancelFrame || (id => globalThis.cancelAnimationFrame(id));
    /** player → { held, ignored, deferredSince, comboDown } */
    this.players = new Map();
    this.sectors = new Map();
    this.menuDown = false;
    this.now = now || (() => globalThis.performance.now());
    this.primePending = false;
    this.frame = 0;
    this.running = false;
    this.tick = () => { this.frame = 0; if (!this.running) return; this.poll(); if (this.running && !this.frame) this.frame = this.requestFrame(this.tick); };
  }
  /** Buttons player 1 holds (the single-player view). */
  get held() { return this.#player(0).held; }
  #player(player) {
    let state = this.players.get(player);
    if (!state) { state = { held: new Set(), ignored: new Set(), deferredSince: new Map(), comboDown: false }; this.players.set(player, state); }
    return state;
  }
  start() { if (this.running) return; this.running = true; this.primePending = true; if (!this.frame) this.frame = this.requestFrame(this.tick); }
  stop() {
    this.running = false;
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
    this.releaseAll();
  }
  releaseAll() {
    for (const [player, state] of this.players) {
      if (state.held.size) this.onChange([], [...state.held], player);
      state.held = new Set();
      state.deferredSince.clear();
    }
    this.sectors.clear();
    this.menuDown = false;
  }
  poll() {
    let pads = [];
    try { pads = (this.getGamepads() || []).filter(Boolean); } catch { pads = []; }
    const raw = new Map();
    const active = new Set();
    let menu = false;
    for (const pad of pads) {
      const state = readGamepad(pad, { previousSector: this.sectors.get(pad.index) ?? -1 });
      this.sectors.set(pad.index, state.sector);
      menu = menu || state.menu;
      let player = null;
      try { player = this.playerFor(pad, state.active); } catch { player = 0; }
      if (!Number.isInteger(player) || player < 0) continue;
      if (state.active) active.add(player);
      if (!raw.has(player)) raw.set(player, new Set());
      for (const name of state.buttons) raw.get(player).add(name);
    }
    const t = this.now();
    const prime = this.primePending;
    this.primePending = false;
    if (prime) this.menuDown = menu;
    let comboEdge = false;
    const all = { pressed: [], released: [] };
    const changes = [];
    for (const player of new Set([...raw.keys(), ...this.players.keys()])) {
      const state = this.#player(player);
      const buttons = raw.get(player) || new Set();
      if (prime) {
        for (const name of buttons) state.ignored.add(name);
        state.comboDown = buttons.has('BUTTON_SELECT') && buttons.has('BUTTON_START');
      }
      for (const name of [...state.ignored]) if (!buttons.has(name)) state.ignored.delete(name);
      // Select + Start together: the menu, and neither button reaches the game.
      const combo = buttons.has('BUTTON_SELECT') && buttons.has('BUTTON_START');
      if (combo && !state.comboDown) {
        comboEdge = true;
        for (const name of SYSTEM_BUTTONS) { state.ignored.add(name); state.deferredSince.delete(name); }
      }
      state.comboDown = combo;
      const effective = new Set([...buttons].filter(name => !state.ignored.has(name)));
      for (const name of SYSTEM_BUTTONS) {
        if (state.held.has(name)) { state.deferredSince.delete(name); continue; }
        if (effective.has(name)) {
          // A new press of Select or Start waits a moment for the other one.
          if (!state.deferredSince.has(name)) state.deferredSince.set(name, t);
          if (t - state.deferredSince.get(name) < MENU_COMBO_MS) effective.delete(name);
          else state.deferredSince.delete(name);
        } else if (state.deferredSince.has(name)) {
          // Tapped and let go before it was delivered: press it now, the release follows next frame.
          state.deferredSince.delete(name);
          if (!state.ignored.has(name)) effective.add(name);
        }
      }
      const pressed = [...effective].filter(name => !state.held.has(name));
      const released = [...state.held].filter(name => !effective.has(name));
      state.held = effective;
      if (pressed.length || released.length) changes.push([pressed, released, player]);
      all.pressed.push(...pressed);
      all.released.push(...released);
    }
    // Players that let go come first: a controller moved to another player is let go on the old one before it presses on the new one.
    changes.sort((a, b) => (b[1].length ? 1 : 0) - (a[1].length ? 1 : 0));
    for (const [pressed, released, player] of changes) this.onChange(pressed, released, player);
    for (const player of active) this.onActivity(player);
    if ((menu && !this.menuDown) || comboEdge) this.onMenu();
    this.menuDown = menu;
    return all;
  }
}

// Moving around the interface with a controller: d-pad / left stick moves the focus to the
// nearest control in that direction, A (bottom face button) selects, B (right) goes back,
// X (left) favourite, Y (top) details, L/R change the system filter, Start/Guide open menus.
// Labels follow the standard (Xbox-style) layout most Android and PC controllers use.

export type NavDirection = 'up' | 'down' | 'left' | 'right';
export type NavAction =
  | { type: 'move'; dir: NavDirection }
  | { type: 'confirm' | 'back' | 'x' | 'y' | 'l' | 'r' | 'start' | 'select' | 'guide' };

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * The control to move to from `from` in direction `dir`: the closest one whose centre lies in
 * that direction, preferring controls in line with the current one. Returns an index or -1.
 */
export function pickNeighbor(from: Rect, candidates: Rect[], dir: NavDirection): number {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((rect, index) => {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = cx - fx;
    const dy = cy - fy;
    let primary: number, cross: number, overlap: boolean;
    if (dir === 'left' || dir === 'right') {
      primary = dir === 'right' ? rect.left - (from.left + from.width) : from.left - (rect.left + rect.width);
      if ((dir === 'right' ? dx : -dx) <= 1) return;
      cross = Math.abs(dy);
      overlap = rect.top < from.top + from.height && from.top < rect.top + rect.height;
    } else {
      primary = dir === 'down' ? rect.top - (from.top + from.height) : from.top - (rect.top + rect.height);
      if ((dir === 'down' ? dy : -dy) <= 1) return;
      cross = Math.abs(dx);
      overlap = rect.left < from.left + from.width && from.left < rect.left + rect.width;
    }
    const gap = Math.max(0, primary);
    // In-line controls win; otherwise a sideways step costs more than a straight one.
    const score = (overlap ? 0 : 1_000_000) + gap * 1 + cross * (overlap ? 0.5 : 2);
    if (score < bestScore) { bestScore = score; best = index; }
  });
  return best;
}

const BUTTON_ACTIONS: Record<number, NavAction['type']> = { 0: 'confirm', 1: 'back', 2: 'x', 3: 'y', 4: 'l', 5: 'r', 8: 'select', 9: 'start', 16: 'guide' };
const DIR_BUTTONS: Record<number, NavDirection> = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

interface PadLike { connected?: boolean; mapping?: string; buttons?: ReadonlyArray<{ pressed?: boolean; value?: number } | undefined>; axes?: ReadonlyArray<number> }

const down = (b: { pressed?: boolean; value?: number } | undefined) => Boolean(b && (b.pressed || (typeof b.value === 'number' && b.value > 0.5)));

/** Direction held on a controller: d-pad buttons, left stick, or the hat switch of non-standard pads. */
export function heldDirection(pad: PadLike, deadzone = 0.55): NavDirection | null {
  const buttons = pad.buttons || [];
  for (const [index, dir] of Object.entries(DIR_BUTTONS)) if (down(buttons[Number(index)])) return dir;
  const axes = pad.axes || [];
  const x = Number(axes[0]) || 0, y = Number(axes[1]) || 0;
  if (Math.max(Math.abs(x), Math.abs(y)) >= deadzone) return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  if (pad.mapping !== 'standard' && axes.length > 9) {
    const hat = Number(axes[9]);
    if (hat >= -1.05 && hat <= 1.05) {
      const step = Math.round(((hat + 1) * 7) / 2);
      return (['up', 'right', 'right', 'down', 'down', 'left', 'left', 'up'] as NavDirection[])[step] || null;
    }
  }
  return null;
}

/**
 * Turns controller state into menu actions: a press acts once; a held direction repeats after
 * `delay` ms every `repeat` ms, like a keyboard. `poll(pads, now)` returns the actions of this frame.
 */
export class NavReader {
  delay: number;
  repeat: number;
  #held = new Set<number>();
  #dir: NavDirection | null = null;
  #dirSince = 0;
  #lastRepeat = 0;
  #primed = false;

  constructor({ delay = 380, repeat = 110 } = {}) {
    this.delay = delay;
    this.repeat = repeat;
  }

  /** Forget held buttons; buttons already held when reading starts do not act (no carry-over press). */
  reset() { this.#held.clear(); this.#dir = null; this.#primed = false; }

  poll(pads: ReadonlyArray<PadLike | null | undefined>, now: number): NavAction[] {
    const actions: NavAction[] = [];
    const held = new Set<number>();
    let dir: NavDirection | null = null;
    for (const pad of pads) {
      if (!pad || pad.connected === false) continue;
      const buttons = pad.buttons || [];
      for (const index of Object.keys(BUTTON_ACTIONS)) if (down(buttons[Number(index)])) held.add(Number(index));
      dir = dir || heldDirection(pad);
    }
    if (!this.#primed) {
      // The first frame only records what is already held (for example the button that opened the menu).
      this.#primed = true;
      this.#held = held;
      this.#dir = dir;
      this.#dirSince = now;
      this.#lastRepeat = now;
      return actions;
    }
    for (const index of held) if (!this.#held.has(index)) actions.push({ type: BUTTON_ACTIONS[index] } as NavAction);
    this.#held = held;
    if (dir !== this.#dir) {
      this.#dir = dir;
      this.#dirSince = now;
      this.#lastRepeat = now;
      if (dir) actions.push({ type: 'move', dir });
    } else if (dir && now - this.#dirSince >= this.delay && now - this.#lastRepeat >= this.repeat) {
      this.#lastRepeat = now;
      actions.push({ type: 'move', dir });
    }
    return actions;
  }
}

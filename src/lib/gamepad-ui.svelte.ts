// Controller navigation of the interface (see gamepad-nav.ts for the rules). The topmost scope —
// the screen, a dialog, or the pause menu — receives the controller; while a game runs with its
// menu closed the controller belongs to the game and this is suspended.
import { NavReader, pickNeighbor, type NavAction, type NavDirection } from './gamepad-nav.ts';

export interface NavScope {
  /** Where focus may move. */
  root: () => HTMLElement | null;
  /** Return true when the action was handled (for example B closes a dialog). */
  onAction?: (action: NavAction, focused: HTMLElement | null) => boolean | void;
  /** Dialogs and menus: actions they do not handle do not reach the screen underneath. */
  modal?: boolean;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]):not([type="file"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visible(el: HTMLElement): boolean {
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const rects = el.getClientRects();
  if (!rects.length) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.01;
}

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

/** Moves focus from the focused control to its neighbour in `dir` inside `root`. */
export function moveFocus(root: HTMLElement, dir: NavDirection): HTMLElement | null {
  const items = focusables(root);
  if (!items.length) return null;
  const current = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement : null;
  let next: HTMLElement | null = null;
  if (!current) {
    // Start where the screen's main action is, then in the content, then anywhere.
    const preferred = [...root.querySelectorAll<HTMLElement>('[data-nav-default]')].find(visible);
    const content = root.querySelector<HTMLElement>('.app-content');
    next = preferred || (content ? items.find(el => content.contains(el)) : undefined) || items[0];
  } else {
    const others = items.filter(el => el !== current);
    // Up and down stay in the same column (the sidebar or the page) while it has somewhere to go;
    // left and right cross between them.
    const region = dir === 'up' || dir === 'down' ? current.closest('[data-nav-region]') : null;
    const near = region ? others.filter(el => region.contains(el)) : [];
    for (const pool of near.length ? [near, others] : [others]) {
      const index = pickNeighbor(current.getBoundingClientRect(), pool.map(el => el.getBoundingClientRect()), dir);
      if (index >= 0) { next = pool[index]; break; }
    }
  }
  if (next) {
    next.focus({ preventScroll: true });
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }
  return next;
}

class GamepadUI {
  /** A controller has been used to move around (focus rings and button hints are shown). */
  navigating = $state(false);
  connected = $state(false);
  #scopes: NavScope[] = [];
  #reader = new NavReader();
  #frame = 0;
  #suspended = false;
  #started = false;

  start() {
    if (this.#started || typeof window === 'undefined') return;
    this.#started = true;
    const update = () => {
      this.connected = this.#pads().length > 0;
      if (this.connected) this.#loop(); else this.#stop();
    };
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    window.addEventListener('pointerdown', () => { if (this.navigating) this.setNavigating(false); }, { capture: true, passive: true });
    update();
  }

  #pads() {
    try { return typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].filter(Boolean) as Gamepad[] : []; } catch { return []; }
  }

  #loop() {
    if (this.#frame) return;
    const tick = () => {
      this.#frame = requestAnimationFrame(tick);
      if (this.#suspended || document.visibilityState !== 'visible') return;
      const actions = this.#reader.poll(this.#pads(), performance.now());
      for (const action of actions) this.#handle(action);
    };
    this.#frame = requestAnimationFrame(tick);
  }

  #stop() {
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#reader.reset();
  }

  /** On a TV there is no pointer: focus is always shown. */
  #sticky = false;

  setNavigating(on: boolean) {
    if (this.#sticky && !on) return;
    this.navigating = on;
    document.documentElement.classList.toggle('gp-nav', on);
  }

  stickyNavigation() {
    this.#sticky = true;
    this.setNavigating(true);
  }

  /** The game takes the controller (true) or gives it back to the interface (false). */
  suspend(on: boolean) {
    if (this.#suspended === on) return;
    this.#suspended = on;
    this.#reader.reset();
  }

  push(scope: NavScope): () => void {
    this.#scopes.push(scope);
    this.#reader.reset();
    return () => {
      const index = this.#scopes.lastIndexOf(scope);
      if (index >= 0) this.#scopes.splice(index, 1);
      this.#reader.reset();
    };
  }

  /** Navigation from another source (the TV remote); true when something handled it. */
  dispatch(action: NavAction): boolean {
    return this.#handle(action);
  }

  #handle(action: NavAction): boolean {
    const scope = this.#scopes[this.#scopes.length - 1];
    const root = scope?.root() || document.body;
    if (!this.navigating) this.setNavigating(true);
    const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) && document.activeElement !== document.body ? document.activeElement : null;
    for (let i = this.#scopes.length - 1; i >= 0; i--) {
      const layer = this.#scopes[i];
      if (layer.onAction?.(action, focused)) return true;
      if (layer.modal) break;
    }
    if (action.type === 'move') {
      if (focused instanceof HTMLInputElement && focused.type === 'range' && (action.dir === 'left' || action.dir === 'right')) {
        if (action.dir === 'left') focused.stepDown(); else focused.stepUp();
        focused.dispatchEvent(new Event('input', { bubbles: true }));
        focused.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      moveFocus(root, action.dir);
      return true;
    }
    if (action.type === 'confirm') {
      if (!focused) { moveFocus(root, 'down'); return true; }
      if (focused instanceof HTMLInputElement && (focused.type === 'checkbox' || focused.type === 'radio')) focused.click();
      else if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) focused.focus();
      else focused.click();
      return true;
    }
    if (action.type === 'x' || action.type === 'y') {
      const target = focused?.closest<HTMLElement>(`[data-nav-${action.type}]`);
      const id = target?.getAttribute(`data-nav-${action.type}`);
      if (target && id) { target.dispatchEvent(new CustomEvent(`nav-${action.type}`, { bubbles: true, detail: id })); return true; }
    }
    return false;
  }
}

export const gamepadUI = new GamepadUI();

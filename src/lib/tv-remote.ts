// The TV remote as the page receives it from the TV app 1.3+ (window.RetroPlayTVHost.remote):
// the app takes the remote's d-pad and OK itself, because TV makers' WebViews do not all pass
// them to the page (see tv/android KeyRoute). Plain logic here, without the DOM, so it is tested.

export type RemoteKey = 'up' | 'down' | 'left' | 'right' | 'ok';

/** The keyboard key each remote key stands for on the page. */
export const REMOTE_KEYS: Record<RemoteKey, { key: string; keyCode: number }> = {
  up: { key: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', keyCode: 39 },
  ok: { key: 'Enter', keyCode: 13 }
};

export function remoteKey(name: unknown): RemoteKey | null {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(REMOTE_KEYS, name) ? name as RemoteKey : null;
}

/**
 * OK arrives twice: the app passes the real key press to the WebView (it counts as the user's own
 * action, which opening the file chooser needs) and tells the page as well. The real press is
 * used when it arrives; when it does not (some TVs' WebViews drop it), the page presses the
 * focused item itself, and a real press arriving late after that is not used a second time.
 */
export class OkGate {
  /** How long the page waits for the real press after the app's message. */
  readonly wait: number;
  #real = -Infinity;
  #pressed = -Infinity;
  /** The page pressed and the real press for it may still come. */
  #owed = false;

  constructor(wait = 160) {
    this.wait = wait;
  }

  /**
   * A real Enter reached the page at `now`. False when it is the late real press of an OK the
   * page has already pressed for (dropped, so the item is not pressed twice).
   */
  real(now: number): boolean {
    if (this.#owed && now - this.#pressed < 800) { this.#owed = false; return false; }
    this.#owed = false;
    this.#real = now;
    return true;
  }

  /** The app's message came at `askedAt`; at `now` (`wait` later): should the page press itself? */
  shouldPress(askedAt: number, now: number): boolean {
    if (this.#real >= askedAt - 300) return false;
    this.#pressed = now;
    this.#owed = true;
    return true;
  }
}

const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** A field typed into (the on-screen keyboard), not a checkbox, slider or button. */
export function isTextField(el: unknown): el is HTMLInputElement | HTMLTextAreaElement {
  const node = el as { tagName?: string; type?: string } | null;
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && TEXT_TYPES.has(String(node.type || '').toLowerCase());
}

/** The caret one step left or right in a field being typed into. */
export function caretStep(value: string, position: number | null, dir: 'left' | 'right'): number {
  const at = Number.isInteger(position) ? (position as number) : value.length;
  return Math.max(0, Math.min(value.length, at + (dir === 'left' ? -1 : 1)));
}

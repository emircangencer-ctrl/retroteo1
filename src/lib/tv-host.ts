// What the TV app asks of the page (window.RetroPlayTVHost) and the remote's keys on screens.
import { tv } from './tv.svelte.ts';
import { gamepadUI, setFocusPreparer } from './gamepad-ui.svelte.ts';
import { player } from '../player/session.svelte.ts';
import { showToast } from './toast.svelte.ts';
import { REMOTE_KEYS, remoteKey, OkGate, isTextField, caretStep } from './tv-remote.ts';
import type { NavDirection } from './gamepad-nav.ts';

const ARROWS: Record<string, NavDirection> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const okGate = new OkGate();

/** The remote's Back: menu in a game, closes what is open, previous screen; false on the home screen. */
export function tvBack(): boolean {
  if (player.open && !player.menuOpen && !player.blocked && !player.consent && !(player.error && !player.running)) {
    if (player.running) player.openMenu(); else void player.close();
    return true;
  }
  return gamepadUI.dispatch({ type: 'back' });
}

/** Menu or play/pause on the remote. */
export function tvMenu(): boolean {
  if (!player.open || !player.running) return false;
  player.toggleMenu();
  return true;
}

/** The game has the keys while it runs with its menu closed. */
export function gameHasKeys(): boolean {
  return player.open && player.running && !player.menuOpen;
}

// ---- text fields ------------------------------------------------------------------------------
// On a TV a text field (search) is passed over with the remote like any other item: it is
// read-only until OK is pressed on it, so the on-screen keyboard does not open (and take the
// remote's keys) just because the focus went by. OK opens the keyboard, OK again or the
// keyboard's own Done key closes it.

function lockField(el: HTMLElement) {
  if (!isTextField(el) || el.dataset.tvEditing === '1') return;
  if (!el.readOnly) { el.readOnly = true; el.dataset.tvLocked = '1'; }
}

export function startTyping(el: HTMLInputElement | HTMLTextAreaElement) {
  if (el.dataset.tvLocked === '1') el.readOnly = false;
  el.dataset.tvEditing = '1';
  el.focus({ preventScroll: true });
  try { const end = el.value.length; el.setSelectionRange(end, end); } catch {}
  tv.showKeyboard();
}

export function stopTyping(el: HTMLInputElement | HTMLTextAreaElement) {
  if (el.dataset.tvEditing !== '1') return;
  delete el.dataset.tvEditing;
  if (el.dataset.tvLocked === '1') el.readOnly = true;
  tv.hideKeyboard();
}

export function isTyping(el: unknown): el is HTMLInputElement | HTMLTextAreaElement {
  return isTextField(el) && (el as HTMLElement).dataset.tvEditing === '1';
}

/**
 * The remote's d-pad on screens: arrows move the focus to the nearest item (as a controller does),
 * OK (Enter) presses buttons and links natively and selects other focusable items.
 */
export function onTvKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && event.isTrusted && !okGate.real(performance.now())) {
    // The page already pressed for this OK (the app's message came first): not twice.
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (gameHasKeys()) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  // The pause menu moves up and down itself (when the focus is in it); left and right reach its
  // rows of choices here.
  if (player.menuOpen && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && target?.closest('#player-menu')) return;
  const dir = ARROWS[event.key];
  if (dir) {
    if (isTyping(target) && (dir === 'left' || dir === 'right')) {
      // Typing with the keyboard closed: left and right move the caret.
      if (!event.isTrusted) {
        const at = caretStep(target.value, target.selectionStart, dir);
        try { target.setSelectionRange(at, at); } catch {}
      }
      return;
    }
    event.preventDefault();
    gamepadUI.dispatch({ type: 'move', dir });
    return;
  }
  if (event.key === 'Enter' && target) {
    if (isTextField(target)) {
      event.preventDefault();
      if (isTyping(target)) stopTyping(target); else startTyping(target);
      return;
    }
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement || target.tagName === 'SUMMARY') {
      // A real Enter presses them natively; one sent by the app is pressed here.
      if (!event.isTrusted) { event.preventDefault(); target.click(); }
      return;
    }
    event.preventDefault();
    gamepadUI.dispatch({ type: 'confirm' });
  }
}

function focusedOrBody(): HTMLElement {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body && active.isConnected ? active : document.body;
}

function sendKey(name: keyof typeof REMOTE_KEYS, repeat: boolean, target: HTMLElement = focusedOrBody()): KeyboardEvent {
  const { key, keyCode } = REMOTE_KEYS[name];
  const event = new KeyboardEvent('keydown', { key, code: key, keyCode, which: keyCode, repeat, bubbles: true, cancelable: true, composed: true } as KeyboardEventInit);
  (target.isConnected ? target : document.body).dispatchEvent(event);
  return event;
}

/**
 * A remote key from the TV app 1.3+ (it no longer arrives as a keyboard key on screens). It goes
 * through the same handlers as a key would (this file, the pause menu, dialogs).
 */
export function tvRemote(name: unknown, phase: unknown = 'down', repeat: unknown = 0): boolean {
  const key = remoteKey(name);
  if (!key || phase !== 'down') return false;
  if (key === 'ok') {
    // The item focused when OK was pressed, even if the focus moves on before the page presses it.
    const askedAt = performance.now();
    const target = focusedOrBody();
    setTimeout(() => { if (okGate.shouldPress(askedAt, performance.now())) sendKey('ok', false, target); }, okGate.wait);
    return true;
  }
  sendKey(key, Number(repeat) > 0);
  return true;
}

export function installTvHost() {
  if (!tv.active) return;
  tv.start();
  gamepadUI.stickyNavigation();
  setFocusPreparer(lockField);
  document.addEventListener('keydown', onTvKey, true);
  document.addEventListener('focusout', event => { if (isTyping(event.target)) stopTyping(event.target); }, true);
  // Focus always somewhere on the screens (the game and its menu manage their own).
  setInterval(() => {
    if (document.visibilityState !== 'visible' || player.open || !document.hasFocus()) return;
    gamepadUI.restoreFocus();
  }, 400);
  (window as unknown as { RetroPlayTVHost: unknown }).RetroPlayTVHost = {
    back: tvBack,
    menu: tvMenu,
    remote: tvRemote,
    inboxChanged: () => tv.refreshInbox(),
    noFilePicker: () => showToast('Bu TV\'de dosya seçici yok. Oyunları "Telefondan gönder" ile ekle.', 'error')
  };
}

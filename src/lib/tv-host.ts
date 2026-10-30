// What the TV app asks of the page (window.RetroPlayTVHost) and the remote's keys on screens.
import { tv } from './tv.svelte.ts';
import { gamepadUI } from './gamepad-ui.svelte.ts';
import { player } from '../player/session.svelte.ts';
import { showToast } from './toast.svelte.ts';
import type { NavDirection } from './gamepad-nav.ts';

const ARROWS: Record<string, NavDirection> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

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
function gameHasKeys(): boolean {
  return player.open && player.running && !player.menuOpen;
}

/**
 * The remote's d-pad on screens: arrows move the focus to the nearest item (as a controller does),
 * OK (Enter) presses buttons and links natively and selects other focusable items.
 */
export function onTvKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (gameHasKeys()) return;
  // The pause menu moves up and down itself; left and right reach its rows of choices here.
  if (player.menuOpen && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) return;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const dir = ARROWS[event.key];
  if (dir) {
    const typing = target instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(target.type) || target instanceof HTMLTextAreaElement;
    if (typing && (dir === 'left' || dir === 'right')) return;
    event.preventDefault();
    gamepadUI.dispatch({ type: 'move', dir });
    return;
  }
  if (event.key === 'Enter' && target && !(target instanceof HTMLButtonElement) && !(target instanceof HTMLAnchorElement) && !(target instanceof HTMLTextAreaElement)) {
    if (target instanceof HTMLInputElement && !['checkbox', 'radio'].includes(target.type)) return;
    event.preventDefault();
    gamepadUI.dispatch({ type: 'confirm' });
  }
}

export function installTvHost() {
  if (!tv.active) return;
  tv.start();
  gamepadUI.stickyNavigation();
  document.addEventListener('keydown', onTvKey, true);
  (window as unknown as { RetroPlayTVHost: unknown }).RetroPlayTVHost = {
    back: tvBack,
    menu: tvMenu,
    inboxChanged: () => tv.refreshInbox(),
    noFilePicker: () => showToast('Bu TV\'de dosya seçici yok. Oyunları "Telefondan gönder" ile ekle.', 'error')
  };
}

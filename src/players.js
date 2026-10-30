// Local multiplayer: which player (the core's controller port) every input plays as.
//
// A controller gets a player the first time a button is pressed on it: the lowest one no other
// controller has, so the first controller used is player 1, the next one player 2 … It keeps that
// player until it is disconnected. The touch pad and the keyboard play as player 1 unless chosen
// otherwise. With one controller nothing changes from single-player: every input is player 1, so
// picking up a controller in the middle of a game still plays it. A controller that was never
// used holds no player (Android phones can list sensors as controllers). Choices made in the game
// menu are kept for the app session (devices change from one session to the next).

export const MAX_PLAYERS = 4;

/**
 * How many players a game can have: the consoles' two controller ports, an arcade cabinet's own
 * count (MAME's input data; up to four), four when the cabinet is not known.
 */
export function playerCount(platform, arcade = null) {
  if (platform !== 'ARCADE') return 2;
  const players = Math.floor(Number(arcade?.players));
  return players >= 1 ? Math.min(MAX_PLAYERS, players) : MAX_PLAYERS;
}

/** A controller's identity for the session (its slot and name). */
export const padKey = pad => `${Number.isInteger(pad?.index) ? pad.index : -1}:${String(pad?.id || '')}`;

/** A short controller name for the menu ("Xbox Wireless Controller", not the vendor/product suffix). */
export function padName(pad) {
  // Chrome: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"; Firefox: "054c-09cc-Wireless Controller".
  const id = String(pad?.id || '').replace(/\s*\([^)]*(?:STANDARD GAMEPAD|Vendor:)[^)]*\)\s*$/i, '').replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '').trim();
  return id.slice(0, 40) || `Kumanda ${Number.isInteger(pad?.index) ? pad.index + 1 : ''}`.trim();
}

const clampPlayer = (player, count) => (Number.isInteger(player) && player >= 0 && player < count ? player : 0);

export class PlayerAssignment {
  constructor({ count = 2 } = {}) {
    this.count = Math.max(1, Math.min(MAX_PLAYERS, Math.floor(count) || 1));
    this.touch = 0;
    this.keyboard = 0;
    /** key → { key, index, name, player, manual } */
    this.pads = new Map();
  }

  /** A new game: players it does not have move to free ones (or player 1). */
  setCount(count) {
    this.count = Math.max(1, Math.min(MAX_PLAYERS, Math.floor(count) || 1));
    this.touch = clampPlayer(this.touch, this.count);
    this.keyboard = clampPlayer(this.keyboard, this.count);
    for (const entry of this.pads.values()) if (entry.player >= this.count) entry.player = this.#free(entry);
  }

  #free(except) {
    const used = new Set([...this.pads.values()].filter(entry => entry !== except).map(entry => entry.player));
    for (let player = 0; player < this.count; player++) if (!used.has(player)) return player;
    return 0;
  }

  /** The player of a controller; null when it has not been used yet. */
  playerOf(pad) {
    return this.pads.get(padKey(pad))?.player ?? null;
  }

  /** A controller was used: its player, and whether it just got one. */
  use(pad) {
    const key = padKey(pad);
    const known = this.pads.get(key);
    if (known) return { player: known.player, joined: false };
    const entry = { key, index: pad.index, name: padName(pad), player: 0, manual: false };
    entry.player = this.#free(entry);
    this.pads.set(key, entry);
    return { player: entry.player, joined: true };
  }

  /** Controllers no longer connected give their player back. Returns true when one left. */
  sync(pads) {
    const keys = new Set((pads || []).filter(Boolean).map(padKey));
    let changed = false;
    for (const key of [...this.pads.keys()]) if (!keys.has(key)) { this.pads.delete(key); changed = true; }
    return changed;
  }

  /** The player chose a player for a controller in the menu. */
  setPad(pad, player) {
    const key = padKey(pad);
    const entry = this.pads.get(key) || { key, index: pad.index, name: padName(pad), player: 0, manual: true };
    entry.player = clampPlayer(player, this.count);
    entry.manual = true;
    this.pads.set(key, entry);
  }

  setTouch(player) { this.touch = clampPlayer(player, this.count); }
  setKeyboard(player) { this.keyboard = clampPlayer(player, this.count); }

  /** Connected controllers for the menu, in slot order: name, player (null: not used yet). */
  describe(pads) {
    return (pads || []).filter(pad => pad && pad.connected !== false)
      .sort((a, b) => a.index - b.index)
      .map(pad => ({ key: padKey(pad), id: String(pad.id || ''), index: pad.index, name: padName(pad), player: this.playerOf(pad) }));
  }
}

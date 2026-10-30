// Several players with no setting: who plays as whom follows from the devices.
//
// Controllers are players in the order they are connected (the browser's controller slots): the
// first one is player 1, the second player 2 … A controller keeps its player until it is
// disconnected; one connected later takes the lowest free player. Devices the browser does not
// recognise as a gamepad (non-"standard" mapping) take a player only once a button is pressed on
// them, so a phone sensor listed as a joystick (Pixel fingerprint sensors: "uinput-fpc") never
// takes player 1. The keyboard is two players at once (emulatorjs-nes-player.js), the touch pad
// is player 1. A game with fewer players than controllers gives the extra ones to player 1, so
// any controller plays a one-player game.

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

/** A short controller name ("Xbox Wireless Controller", without the browser's vendor/product suffix). */
export function padName(pad) {
  // Chrome: "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"; Firefox: "054c-09cc-Wireless Controller".
  const id = String(pad?.id || '').replace(/\s*\([^)]*(?:STANDARD GAMEPAD|Vendor:)[^)]*\)\s*$/i, '').replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '').trim();
  return id.slice(0, 40) || `Kumanda ${Number.isInteger(pad?.index) ? pad.index + 1 : ''}`.trim();
}

/** Devices phones list as controllers that are not (fingerprint sensors). */
const NOT_A_CONTROLLER = /uinput-fpc|uinput-goodix|fingerprint|gf_input|fpc_?\d/i;

export class PadPlayers {
  constructor() {
    /** controller key → player (0 = player 1) */
    this.players = new Map();
    /** called with (pad, player) when a controller gets a player */
    this.onJoin = null;
  }

  /**
   * The player a controller plays as in a game with `count` players; null while it has none (a
   * device that is not a recognised gamepad and has not been used). Call for the connected
   * controllers in slot order, so the ones present together are numbered in that order.
   */
  playerFor(pad, { active = false, count = MAX_PLAYERS } = {}) {
    const key = padKey(pad);
    let player = this.players.get(key);
    if (player === undefined) {
      if (NOT_A_CONTROLLER.test(String(pad?.id || ''))) return null;
      if (pad?.mapping !== 'standard' && !active) return null;
      const used = new Set(this.players.values());
      player = 0;
      while (used.has(player)) player++;
      this.players.set(key, player);
      this.onJoin?.(pad, player);
    }
    return player < count ? player : 0;
  }

  /** Controllers no longer connected give their player back. */
  sync(pads) {
    const keys = new Set((pads || []).filter(Boolean).map(padKey));
    for (const key of [...this.players.keys()]) if (!keys.has(key)) this.players.delete(key);
  }

  /** The connected controllers with their players, in slot order (for the menu). */
  describe(pads, count = MAX_PLAYERS) {
    return (pads || []).filter(pad => pad && pad.connected !== false)
      .sort((a, b) => a.index - b.index)
      .map(pad => {
        const player = this.players.get(padKey(pad));
        return { key: padKey(pad), index: pad.index, name: padName(pad), player: player === undefined ? null : player < count ? player : 0 };
      });
  }
}

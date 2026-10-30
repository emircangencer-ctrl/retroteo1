export const STANDARD_TO_RETROPAD: Readonly<Record<number, string>>;
export const MENU_BUTTON_INDEX: number;
export const MENU_COMBO_MS: number;
export function readGamepad(pad: unknown, options?: { deadzone?: number; previousSector?: number }): { buttons: Set<string>; sector: number; menu: boolean; active: boolean };
export class GamepadPoller {
  constructor(options?: {
    getGamepads?: () => ReadonlyArray<unknown>;
    onChange?: (pressed: string[], released: string[], player: number) => void;
    onActivity?: (player: number) => void;
    onMenu?: () => void;
    /** The player (0 = player 1) a controller plays as; null leaves it out. */
    playerFor?: (pad: { index: number; id: string }, active: boolean) => number | null;
    requestFrame?: (callback: () => void) => number;
    cancelFrame?: (id: number) => void;
    now?: () => number;
  });
  running: boolean;
  readonly held: Set<string>;
  start(): void;
  stop(): void;
  releaseAll(): void;
  poll(): { pressed: string[]; released: string[] };
}

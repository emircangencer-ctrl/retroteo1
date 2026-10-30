export const MAX_PLAYERS: number;
export function playerCount(platform: string, arcade?: { players?: number } | null): number;
interface PadLike { index: number; id: string; connected?: boolean }
export function padKey(pad: PadLike): string;
export function padName(pad: PadLike): string;
export interface PadPlayer { key: string; id: string; index: number; name: string; player: number | null }
export class PlayerAssignment {
  constructor(options?: { count?: number });
  count: number;
  touch: number;
  keyboard: number;
  setCount(count: number): void;
  playerOf(pad: PadLike): number | null;
  use(pad: PadLike): { player: number; joined: boolean };
  sync(pads: ReadonlyArray<PadLike | null | undefined>): boolean;
  setPad(pad: PadLike, player: number): void;
  setTouch(player: number): void;
  setKeyboard(player: number): void;
  describe(pads: ReadonlyArray<PadLike | null | undefined>): PadPlayer[];
}

export const MAX_PLAYERS: number;
export function playerCount(platform: string, arcade?: { players?: number } | null): number;
interface PadLike { index: number; id: string; mapping?: string; connected?: boolean }
export function padKey(pad: PadLike): string;
export function padName(pad: PadLike): string;
export interface PadPlayer { key: string; index: number; name: string; player: number | null }
export class PadPlayers {
  players: Map<string, number>;
  onJoin: ((pad: PadLike, player: number) => void) | null;
  playerFor(pad: PadLike, options?: { active?: boolean; count?: number }): number | null;
  sync(pads: ReadonlyArray<PadLike | null | undefined>): void;
  describe(pads: ReadonlyArray<PadLike | null | undefined>, count?: number): PadPlayer[];
}

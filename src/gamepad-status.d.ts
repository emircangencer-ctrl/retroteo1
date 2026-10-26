export interface GamepadStatus { state: 'unsupported' | 'unavailable' | 'connected' | 'disconnected'; supported: boolean; connected: Array<{ index: number; id: string; mapping: string }> }
export function inspectGamepads(navigatorLike?: unknown): GamepadStatus;
export function describeGamepads(status: GamepadStatus | null | undefined): string;

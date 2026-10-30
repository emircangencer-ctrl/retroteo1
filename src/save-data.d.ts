export function emulatorGameId(game: { platform: string; contentHash?: string | null; id: string }): number;
export function createBatterySaveRecord(game: any, update: { bytes?: Uint8Array | ArrayBuffer | null; updatedAt?: number; systemId?: string; hash?: string }, fallbackSystemId?: string): any;

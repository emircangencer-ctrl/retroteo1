const MAX_EMULATOR_GAME_ID = 0x7fffffff;

export function emulatorGameId(game) {
  if (!game || !game.platform || !(game.contentHash || game.id)) {
    throw new TypeError('A platform and stable game identity are required for save data.');
  }
  const source = `${game.platform}:${game.contentHash || game.id}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  }
  return ((hash >>> 0) & MAX_EMULATOR_GAME_ID) || 1;
}

function cloneBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return new Uint8Array(0);
}

export function createBatterySaveRecord(game, update, fallbackSystemId) {
  const bytes = cloneBytes(update?.bytes);
  if (!bytes.byteLength) return null;
  return {
    id: game.id,
    gameId: emulatorGameId(game),
    platform: game.platform,
    systemId: update?.systemId || fallbackSystemId || game.platform,
    contentHash: game.contentHash || null,
    saveHash: String(update?.hash || ''),
    bytes,
    byteLength: bytes.byteLength,
    updatedAt: Number(update?.updatedAt) || Date.now()
  };
}

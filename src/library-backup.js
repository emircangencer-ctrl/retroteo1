const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Return a validated CSS hex color or a caller-provided safe fallback. */
export function safeCoverColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value : fallback;
}

/** Validate untrusted library-backup metadata before previewing or storing it. */
export function validBackup(data) {
  if (!data || data.app !== 'RetroPlay' || data.backupType !== 'library-metadata' || data.schemaVersion !== 1 || !Array.isArray(data.games)) return false;
  if (data.games.length > 10000) return false;

  const textField = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
  const optionalText = (value, max) => value === undefined || value === null || (typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value));
  const safeColor = value => value === undefined || value === null || (typeof value === 'string' && HEX_COLOR_RE.test(value));

  const ids = new Set();
  return data.games.every(g => {
    if (!g || !textField(g.id, 200) || !textField(g.title, 300) || !textField(g.platform, 32) ||
        !textField(g.fileName, 255) || !Number.isSafeInteger(g.size) || g.size < 0) return false;
    // Reserve demo IDs for the built-in sample cards; duplicate keys would overwrite records.
    if (g.id.startsWith('demo-') || ids.has(g.id)) return false;
    ids.add(g.id);
    if (g.year !== undefined && g.year !== null && (!Number.isInteger(g.year) || g.year < 1970 || g.year > 2100)) return false;
    if (!optionalText(g.genre, 80) || !optionalText(g.symbol, 32) || !optionalText(g.sizeLabel, 40) || !optionalText(g.status, 80)) return false;
    if (!safeColor(g.coverBg) || !safeColor(g.coverGlow)) return false;
    if (g.favorite !== undefined && typeof g.favorite !== 'boolean') return false;
    if (g.restoredMetadataOnly !== undefined && typeof g.restoredMetadataOnly !== 'boolean') return false;
    if (g.addedAt !== undefined && g.addedAt !== null && (!Number.isFinite(g.addedAt) || g.addedAt < 0)) return false;
    if (g.lastPlayed !== undefined && g.lastPlayed !== null && (!Number.isFinite(g.lastPlayed) || g.lastPlayed < 0)) return false;
    if (g.contentHash !== undefined && g.contentHash !== null && (typeof g.contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(g.contentHash))) return false;
    if (g.romValidation !== undefined && g.romValidation !== null && (typeof g.romValidation !== 'object' || Array.isArray(g.romValidation))) return false;
    return true;
  });
}

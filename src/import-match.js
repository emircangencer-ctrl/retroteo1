/**
 * Decides how an imported file relates to the existing library, by content hash.
 * - new: no record has this content.
 * - duplicate: a playable record with the same content already exists → skip.
 * - relink: a record restored from a metadata-only backup (no ROM bytes) matches → attach the
 *   file to that record instead of refusing it, so restored favourites and play history stay.
 */
export function classifyImport(games, contentHash) {
  if (typeof contentHash !== 'string' || !contentHash) return { action: 'new' };
  const existing = (Array.isArray(games) ? games : []).find(game => game && !game.demo && game.contentHash === contentHash);
  if (!existing) return { action: 'new' };
  const hasRom = typeof Blob !== 'undefined' && existing.blob instanceof Blob;
  if (existing.restoredMetadataOnly === true || !hasRom) return { action: 'relink', game: existing };
  return { action: 'duplicate', game: existing };
}

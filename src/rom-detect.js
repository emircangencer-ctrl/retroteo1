import { PLATFORM } from './platforms.js';

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function fileExtension(name) {
  const text = String(name || '');
  const dot = text.lastIndexOf('.');
  return dot >= 0 ? text.slice(dot + 1).toLowerCase() : '';
}

/**
 * Sega Mega Drive / Genesis cartridges carry a system name at offset 0x100
 * ("SEGA MEGA DRIVE" or "SEGA GENESIS"). `.bin` is ambiguous across systems, so a `.bin`
 * file is treated as Mega Drive only when this header is present.
 */
export function isMegaDriveHeader(headerBytes) {
  const bytes = toBytes(headerBytes);
  if (!bytes || bytes.byteLength < 0x110) return false;
  let text = '';
  for (let i = 0x100; i < 0x110; i++) text += String.fromCharCode(bytes[i]);
  return /^\s{0,2}SEGA/.test(text);
}

/** Resolves the platform key for an imported ROM from its extension and, for `.bin`, its header. */
export function detectRomPlatform(fileName, headerBytes) {
  const ext = fileExtension(fileName);
  if (!ext) return 'UNKNOWN';
  if (ext === 'bin') return isMegaDriveHeader(headerBytes) ? 'MD' : 'UNKNOWN';
  const match = Object.entries(PLATFORM).find(([, platform]) => platform.ext.includes(ext));
  return match ? match[0] : 'UNKNOWN';
}

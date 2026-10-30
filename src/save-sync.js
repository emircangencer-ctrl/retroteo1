/**
 * Battery-save (SRAM) ownership helpers.
 *
 * EmulatorJS 4.2.3 writes SRAM to its own IndexedDB only on a 5-minute interval and when the
 * page unloads. RetroPlay therefore copies the save out of the running core itself (on pause,
 * on backgrounding, on close and on a short interval) and keeps the authoritative copy in its
 * own database, keyed by the library record rather than by the game title.
 */

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function sameBytes(a, b) {
  const left = toBytes(a);
  const right = toBytes(b);
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i++) if (left[i] !== right[i]) return false;
  return true;
}

/**
 * Decides what to do with save data when a game starts.
 * - restore-app: the app holds a save that differs from what the core loaded → load it into the core.
 * - in-sync: both copies are identical → nothing to do.
 * - adopt-core: only the emulator has a save (for example from before this fix) → copy it into the app.
 * - none: no save anywhere yet.
 * Existing emulator saves are never discarded when the app has nothing to restore.
 */
export function decideSaveRestore({ appBytes = null, coreBytes = null } = {}) {
  const app = toBytes(appBytes);
  const core = toBytes(coreBytes);
  if (app && app.byteLength) return core && sameBytes(app, core) ? 'in-sync' : 'restore-app';
  if (core && core.byteLength) return 'adopt-core';
  return 'none';
}

/**
 * Creates a capture function that reads the current save, skips unchanged data and persists
 * changes strictly in order. A failed write is retried on the next capture.
 */
export function createSaveCapture({ read, persist }) {
  if (typeof read !== 'function' || typeof persist !== 'function') throw new TypeError('read and persist are required');
  let last = null;
  let queue = Promise.resolve();
  return {
    prime(bytes) {
      const data = toBytes(bytes);
      last = data && data.byteLength ? new Uint8Array(data) : null;
    },
    capture(reason = 'manual') {
      let bytes = null;
      try { bytes = toBytes(read()); } catch { bytes = null; }
      if (!bytes || !bytes.byteLength) return Promise.resolve({ status: 'empty', reason });
      if (last && sameBytes(bytes, last)) return Promise.resolve({ status: 'unchanged', reason });
      const snapshot = new Uint8Array(bytes);
      last = snapshot;
      const write = queue.then(() => persist(snapshot, reason)).then(
        () => ({ status: 'saved', reason, byteLength: snapshot.byteLength }),
        error => {
          if (last === snapshot) last = null;
          return { status: 'failed', reason, error };
        }
      );
      queue = write;
      return write;
    },
    get lastBytes() { return last; }
  };
}

// In-game saves (battery-backed SRAM): the app keeps its own copy of what the game saved, so a save
// survives the emulator's storage being cleared. At start the app copy and the core's copy are
// reconciled; while playing the SRAM is copied out every 30 s, on pause, when the app goes to the
// background and on exit, and stored only when it changed.
import { getEmulatedSystem } from '../emulator-systems.js';
import { createBatterySaveRecord } from '../save-data.js';
import { createSaveCapture, decideSaveRestore } from '../save-sync.js';
import * as db from '../lib/db.ts';
import { library } from '../lib/library.svelte.ts';
import type { Game } from '../lib/types.ts';

export const SAVE_CAPTURE_INTERVAL_MS = 30_000;

/** The emulator's side of saves (EmulatorJsPlayer). */
export interface SaveSource {
  readSaveData(options: { flush: boolean }): Uint8Array | null;
  writeSaveData(bytes: Uint8Array | null): boolean;
  restartGame(): boolean;
}

export class BatterySaves {
  #capture: ReturnType<typeof createSaveCapture> | null = null;
  #timer: ReturnType<typeof setInterval> | 0 = 0;
  #onFailure: (message: string) => void;

  /** `onFailure`: a save could not be stored (the player sees why). */
  constructor({ onFailure }: { onFailure: (message: string) => void }) { this.#onFailure = onFailure; }

  /**
   * Loads the app-owned battery save into the core when it differs from what EmulatorJS loaded,
   * or adopts the emulator's own copy when the app has none yet. ok=false means an existing app
   * save could not be loaded; capturing is then disabled so that copy is never overwritten.
   */
  async syncOnStart(game: Game, player: SaveSource): Promise<{ ok: boolean; primed: Uint8Array | null; reason?: string }> {
    let record = null;
    try { record = await db.getBatterySave(game.id); } catch (error) { console.warn('[RetroPlay] Kayıt okunamadı:', error); return { ok: false, primed: null, reason: 'Kayıt veritabanı okunamadı' }; }
    const appBytes = record?.bytes ? (record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes)) : null;
    const coreBytes = player.readSaveData({ flush: false });
    const decision = decideSaveRestore({ appBytes, coreBytes });
    if (decision === 'restore-app') {
      let restored = false;
      try { restored = player.writeSaveData(appBytes) && player.restartGame(); } catch (error) { console.warn('[RetroPlay] Kayıt geri yüklenemedi:', error); }
      return restored ? { ok: true, primed: appBytes } : { ok: false, primed: null, reason: 'Kayıt emülatöre yüklenemedi' };
    }
    if (decision === 'adopt-core') {
      try { if (await persist(game, coreBytes)) library.noteSave(game.id); } catch (error) { console.warn('[RetroPlay] Emülatör kaydı uygulamaya alınamadı:', error); }
      return { ok: true, primed: coreBytes };
    }
    if (decision === 'in-sync') return { ok: true, primed: appBytes };
    // No save anywhere yet: remember the initial SRAM so only real in-game saves are stored.
    return { ok: true, primed: player.readSaveData({ flush: true }) };
  }

  /**
   * Starts copying this game's saves out of the core. `isCurrent`: the player is still the one
   * running (a replaced emulator is never read); `onInterval`: every 30 s, for the session to decide
   * whether to capture now.
   */
  begin(game: Game, player: SaveSource, primed: Uint8Array | null, { isCurrent, onInterval }: { isCurrent: () => boolean; onInterval: () => void }) {
    this.#capture = createSaveCapture({
      read: () => (isCurrent() ? player.readSaveData({ flush: true }) : null),
      persist: (bytes: Uint8Array) => persist(game, bytes).then(saved => { if (saved) library.noteSave(game.id); return saved; })
    });
    this.#capture.prime(primed);
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = setInterval(onInterval, SAVE_CAPTURE_INTERVAL_MS);
  }

  /** Copies the live SRAM out of the core synchronously, then stores it asynchronously. */
  capture(reason: string) {
    if (!this.#capture) return Promise.resolve(null);
    return this.#capture.capture(reason).then(result => {
      if (result?.status === 'failed') this.#onFailure(`Oyun içi kayıt yerel yedeğe yazılamadı: ${(result.error as Error)?.message || result.error}`);
      return result;
    });
  }

  /** A last copy, then no more: the game is closing or switching. */
  end(reason: string) {
    const pending = this.capture(reason);
    if (this.#timer) { clearInterval(this.#timer); this.#timer = 0; }
    this.#capture = null;
    return pending;
  }
}

async function persist(game: Game, bytes: Uint8Array | null): Promise<boolean> {
  const record = createBatterySaveRecord(game, { bytes, updatedAt: Date.now() }, getEmulatedSystem(game.platform)?.emulatorJsSystemId);
  if (!record) return false;
  await db.putBatterySave(record);
  return true;
}

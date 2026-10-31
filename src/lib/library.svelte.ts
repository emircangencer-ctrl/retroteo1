// The library as the interface sees it: games, which of them have saves, installed BIOS files.
// Lists are kept as immutable arrays/sets ($state.raw) and replaced on change, so a library of
// thousands of games costs no deep reactive proxies.
import * as db from './db.ts';
import type { BiosRecord, Game, SlotId } from './types.ts';
import { SLOT_IDS } from './types.ts';
import { readZipDirectory } from '../zip-rom.js';
import { identifyArcade } from '../arcade-catalog.js';
import { ARCADE_CATALOG_REV, arcadeRecord, needsArcadeRecheck } from './arcade-records.ts';
import { showToast } from './toast.svelte.ts';
import { coverArt } from './cover-art.svelte.ts';

class Library {
  games = $state.raw<Game[]>([]);
  /** Games with a battery save (SRAM) stored by the app. */
  saveIds = $state.raw<Set<string>>(new Set());
  /** Save-state slots per game. */
  slots = $state.raw<Map<string, Set<SlotId>>>(new Map());
  bios = $state.raw<BiosRecord[]>([]);
  biosIds = $state.raw<Set<string>>(new Set());
  ready = $state(false);
  storageError = $state('');

  async init() {
    try {
      await db.openDB();
      await this.refresh();
      void this.recheckArcadeLibrary();
    } catch (error) {
      this.storageError = (error as Error)?.message || String(error);
      showToast(`Yerel kütüphane başlatılamadı: ${this.storageError}`, 'error');
    } finally {
      this.ready = true;
    }
  }

  async refresh() {
    const [games, saves, stateKeys, bios] = await Promise.all([
      db.allGames(),
      db.allBatterySaves().catch(() => []),
      db.allSaveStateKeys().catch(() => [] as string[]),
      db.allBios().catch(() => [] as BiosRecord[])
    ]);
    // Sample cards of earlier versions were never stored; anything stored is the user's.
    this.games = games.filter(g => !g.demo);
    this.saveIds = new Set(saves.map(save => save.id));
    const slots = new Map<string, Set<SlotId>>();
    for (const key of stateKeys) {
      const at = key.lastIndexOf(':');
      if (at <= 0) continue;
      const slot = key.slice(at + 1) as SlotId;
      if (!SLOT_IDS.includes(slot)) continue;
      const id = key.slice(0, at);
      if (!slots.has(id)) slots.set(id, new Set());
      slots.get(id)!.add(slot);
    }
    this.slots = slots;
    this.setBios(bios);
  }

  setBios(records: BiosRecord[]) {
    this.bios = records.slice().sort((a, b) => a.id.localeCompare(b.id));
    this.biosIds = new Set(records.map(record => record.id));
  }

  async refreshBios() {
    try { this.setBios(await db.allBios()); } catch {}
  }

  get(id: string | null | undefined): Game | null {
    return id ? this.games.find(g => g.id === id) || null : null;
  }

  hasResume(id: string) { return this.slots.get(id)?.has('auto') ?? false; }
  hasAnySave(id: string) { return this.saveIds.has(id) || (this.slots.get(id)?.size ?? 0) > 0; }
  savedIds(): Set<string> {
    const ids = new Set(this.saveIds);
    for (const [id, set] of this.slots) if (set.size) ids.add(id);
    return ids;
  }

  /** Replaces a game in the list (no write). */
  put(game: Game) {
    const index = this.games.findIndex(g => g.id === game.id);
    this.games = index >= 0 ? this.games.map(g => (g.id === game.id ? game : g)) : [...this.games, game];
  }

  /** Stores a game and updates the list. */
  async save(game: Game) {
    await db.saveGame(game);
    this.put(game);
  }

  /** Stores a change to a game; the list changes only if the write succeeds. */
  async patch(id: string, patch: Partial<Game>): Promise<Game | null> {
    const current = this.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    await this.save(next);
    return next;
  }

  noteSave(id: string) {
    if (this.saveIds.has(id)) return;
    this.saveIds = new Set([...this.saveIds, id]);
  }

  noteSlot(id: string, slot: SlotId, present = true) {
    const has = this.slots.get(id)?.has(slot) ?? false;
    if (has === present) return;
    const slots = new Map(this.slots);
    const set = new Set(slots.get(id) || []);
    if (present) set.add(slot); else set.delete(slot);
    if (set.size) slots.set(id, set); else slots.delete(id);
    this.slots = slots;
  }

  async toggleFavorite(id: string) {
    const game = this.get(id);
    if (!game) return;
    try {
      await this.patch(id, { favorite: !game.favorite });
      showToast(!game.favorite ? 'Favorilere eklendi.' : 'Favorilerden çıkarıldı.');
    } catch (error) {
      showToast(`Favori kaydedilemedi: ${(error as Error)?.message || error}`, 'error');
    }
  }

  async remove(id: string) {
    await db.deleteGame(id);
    this.games = this.games.filter(g => g.id !== id);
    void coverArt.forget(id);
    if (this.saveIds.has(id)) this.saveIds = new Set([...this.saveIds].filter(x => x !== id));
    if (this.slots.has(id)) { const slots = new Map(this.slots); slots.delete(id); this.slots = slots; }
  }

  /**
   * Checks an arcade set again with the current cores, once per catalog revision: an incomplete set
   * (an old CPS2 set without its .key runs on FB Alpha 2012), and a MAME 2003-Plus set that
   * RetroPlay's own build of the current MAME 2003-Plus runs better (Namco System 12: full speed,
   * sound), which then starts with that build; the older build stays as the alternative. Other
   * records only get the revision stamp. Only the arcade metadata changes; ROM, saves and record ID stay.
   */
  async recheckArcadeGame(game: Game): Promise<Game> {
    if (!needsArcadeRecheck(game) || !game.arcade) return game;
    try {
      const entries = await readZipDirectory(game.blob!);
      const found = await identifyArcade(game.fileName || `${game.arcade.set}.zip`, entries);
      const moves = game.arcade.status === 'incomplete' || (found?.kind === 'game' && found.core === 'mame2003_plus_next' && found.status !== 'incomplete');
      const arcade = found?.kind === 'game' && moves ? arcadeRecord(found) : { ...game.arcade, checkedWith: ARCADE_CATALOG_REV };
      const current = this.get(game.id) || game;
      const updated = { ...current, arcade };
      await this.save(updated);
      return updated;
    } catch (error) {
      console.warn('Arcade set re-check failed:', error);
      return game;
    }
  }

  async recheckArcadeLibrary() {
    const pending = this.games.filter(needsArcadeRecheck);
    if (!pending.length) return;
    let playable = 0;
    for (const game of pending) {
      const wasIncomplete = game.arcade?.status === 'incomplete';
      const updated = await this.recheckArcadeGame(game);
      if (wasIncomplete && updated.arcade?.status !== 'incomplete') playable++;
    }
    if (playable) showToast(`${playable} arcade oyunu artık açılabiliyor.`);
  }
}

export const library = new Library();

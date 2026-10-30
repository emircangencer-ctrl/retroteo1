// IndexedDB access. The database, its version (4) and its stores are unchanged from earlier
// versions; Faz 2 only adds optional fields to records and new save-state slot keys, so data
// written by any earlier RetroPlay build is read as it is and nothing is converted or deleted.
import type { BatterySaveRecord, BiosRecord, Game, SaveStateRecord, SlotId, SlotInfo } from './types.ts';
import { SLOT_IDS } from './types.ts';

export const DB_NAME = 'retroplay-local-v1';
export const DB_VERSION = 4;
const STORE = 'games';
const SAVE_STORE = 'batterySaves';
const STATE_STORE = 'saveStates';
const BIOS_STORE = 'bios';

let db: IDBDatabase | null = null;

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('Bu tarayıcı IndexedDB desteklemiyor.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const st = d.createObjectStore(STORE, { keyPath: 'id' });
        st.createIndex('addedAt', 'addedAt');
        st.createIndex('platform', 'platform');
      }
      if (!d.objectStoreNames.contains(SAVE_STORE)) d.createObjectStore(SAVE_STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(STATE_STORE)) {
        const states = d.createObjectStore(STATE_STORE, { keyPath: 'id' });
        states.createIndex('gameId', 'gameId');
      }
      if (!d.objectStoreNames.contains(BIOS_STORE)) d.createObjectStore(BIOS_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const opened = req.result;
      opened.onversionchange = () => opened.close();
      db = opened;
      resolve(opened);
    };
    req.onerror = () => reject(req.error || new Error('Yerel veritabanı açılamadı.'));
  });
}

export function dbReady(): boolean { return db !== null; }

function need(): IDBDatabase {
  if (!db) throw new Error('Yerel veritabanı hazır değil.');
  return db;
}

function request<T>(make: () => IDBRequest<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    let r: IDBRequest<T>;
    try { r = make(); } catch (error) { reject(error); return; }
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error(message));
  });
}

function write(stores: string | string[], work: (tx: IDBTransaction) => void, message: string): Promise<true> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = need().transaction(stores, 'readwrite'); work(tx); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error(message));
    tx.onabort = () => reject(tx.error || new Error(message));
  });
}

export const allGames = () => request<Game[]>(() => need().transaction(STORE).objectStore(STORE).getAll(), 'Kütüphane okunamadı.').then(list => list || []);
export const saveGame = (game: Game) => write(STORE, tx => { tx.objectStore(STORE).put(plain(game)); }, 'Oyun kaydı yazılamadı.');

export function deleteGame(id: string) {
  return write([STORE, SAVE_STORE, STATE_STORE], tx => {
    tx.objectStore(STORE).delete(id);
    tx.objectStore(SAVE_STORE).delete(id);
    for (const slot of SLOT_IDS) tx.objectStore(STATE_STORE).delete(stateKey(id, slot));
  }, 'Oyun ve kayıtları silinemedi.');
}

export const allBatterySaves = () => request<BatterySaveRecord[]>(() => need().transaction(SAVE_STORE).objectStore(SAVE_STORE).getAll(), 'Batarya yedekleri okunamadı.').then(list => list || []);
export const getBatterySave = (id: string) => request<BatterySaveRecord | undefined>(() => need().transaction(SAVE_STORE).objectStore(SAVE_STORE).get(id), 'Batarya yedeği okunamadı.').then(r => r || null);
export const putBatterySave = (record: BatterySaveRecord) => write(SAVE_STORE, tx => { tx.objectStore(SAVE_STORE).put(record); }, 'Batarya kaydı yerel olarak yedeklenemedi.');

export const stateKey = (gameId: string, slot: SlotId | string) => `${gameId}:${slot}`;
export const putSaveState = (record: SaveStateRecord) => write(STATE_STORE, tx => { tx.objectStore(STATE_STORE).put(record); }, 'Kayıt noktası yazılamadı.');
export const getSaveState = (gameId: string, slot: SlotId) => request<SaveStateRecord | undefined>(() => need().transaction(STATE_STORE).objectStore(STATE_STORE).get(stateKey(gameId, slot)), 'Kayıt noktası okunamadı.').then(r => r || null);
export const deleteSaveState = (gameId: string, slot: SlotId) => write(STATE_STORE, tx => { tx.objectStore(STATE_STORE).delete(stateKey(gameId, slot)); }, 'Kayıt noktası silinemedi.');
export const allSaveStateKeys = () => request<IDBValidKey[]>(() => need().transaction(STATE_STORE).objectStore(STATE_STORE).getAllKeys(), 'Kayıt noktaları okunamadı.').then(list => (list || []).map(String));

/** Adds a picture to an existing state, only if the state was not replaced in the meantime. */
export function attachStateThumb(gameId: string, slot: SlotId, createdAt: number, thumb: Blob) {
  return write(STATE_STORE, tx => {
    const store = tx.objectStore(STATE_STORE);
    const r = store.get(stateKey(gameId, slot));
    r.onsuccess = () => {
      const record = r.result as SaveStateRecord | undefined;
      if (record && record.createdAt === createdAt) store.put({ ...record, thumb });
    };
  }, 'Kayıt resmi yazılamadı.');
}

/** The slots a game has (without keeping the state bytes around). */
export function listSlots(gameId: string): Promise<SlotInfo[]> {
  return request<SaveStateRecord[]>(() => need().transaction(STATE_STORE).objectStore(STATE_STORE).index('gameId').getAll(gameId), 'Kayıt noktaları okunamadı.')
    .then(list => (list || []).filter(r => SLOT_IDS.includes(r.slot)).map(r => ({ slot: r.slot, createdAt: Number(r.createdAt) || 0, coreId: r.coreId ?? null, byteLength: Number(r.byteLength) || r.bytes?.byteLength || 0, thumb: r.thumb instanceof Blob ? r.thumb : null })));
}

export const allBios = () => request<BiosRecord[]>(() => need().transaction(BIOS_STORE).objectStore(BIOS_STORE).getAll(), 'BIOS dosyaları okunamadı.').then(list => list || []);
export const getBios = (id: string) => request<BiosRecord | undefined>(() => need().transaction(BIOS_STORE).objectStore(BIOS_STORE).get(id), 'BIOS dosyası okunamadı.').then(r => r || null);
export const putBios = (record: BiosRecord) => write(BIOS_STORE, tx => { tx.objectStore(BIOS_STORE).put(record); }, 'BIOS dosyası kaydedilemedi.');
export const deleteBios = (id: string) => write(BIOS_STORE, tx => { tx.objectStore(BIOS_STORE).delete(id); }, 'BIOS dosyası silinemedi.');

/** Bytes used by saves and save states (Settings → Depolama). Reads every record once. */
export function savesFootprint(): Promise<number> {
  return new Promise((resolve, reject) => {
    let total = 0;
    let tx: IDBTransaction;
    try { tx = need().transaction([SAVE_STORE, STATE_STORE]); } catch (error) { reject(error); return; }
    for (const name of [SAVE_STORE, STATE_STORE]) {
      const cursor = tx.objectStore(name).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        const value = c.value as { byteLength?: number; thumb?: Blob };
        total += Number(value.byteLength) || 0;
        if (value.thumb instanceof Blob) total += value.thumb.size;
        c.continue();
      };
    }
    tx.oncomplete = () => resolve(total);
    tx.onerror = () => reject(tx.error || new Error('Kayıtlar okunamadı.'));
  });
}

/**
 * Plain copy of a record for IndexedDB. Svelte's reactive proxies cannot be structured-cloned,
 * so records are unwrapped first (Blobs and typed arrays are kept by reference).
 */
function plain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Blob || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(item => plain(item)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    out[key] = plain(item);
  }
  return out as T;
}
export const plainRecord = plain;

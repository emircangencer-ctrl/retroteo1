// Cover pictures kept on the device. A game's picture is looked up once (covers.ts), fetched from
// libretro-thumbnails, made small (≈20 KB) and kept in its own Cache Storage bucket, so covers show
// offline and are never fetched twice. The bucket is separate from the app's IndexedDB: the library
// database is not touched, older app versions simply do not see it, and the service worker does not
// clear it on updates. A game with no picture is remembered for this version of the lists; a newer
// list looks again. Network problems (and answers that are not pictures) are not remembered: the
// next start tries again.
import { matchCover, romChecksums, coverSets } from './covers.ts';
import { settings } from './settings.svelte.ts';
import type { Game } from './types.ts';

export const COVER_CACHE = 'retroplay-covers-v1';
/** Pictures are kept this wide (cards are at most ~200 CSS px; 2× for sharp screens). */
export const COVER_WIDTH = 320;
/** Changes whenever the lists in /assets/covers change (vite.config.js). */
export const COVER_LISTS = typeof __COVER_LISTS__ === 'string' ? __COVER_LISTS__ : 'dev';
const CHECKSUM_LIMIT = 16 * 1024 * 1024;
const PARALLEL = 2;
const keyOf = (id: string) => `/__covers/${encodeURIComponent(id)}`;

/** What a stored entry says: a picture, nothing for these lists, or removed by the player. */
type Entry = { kind: 'picture'; source: string } | { kind: 'none'; lists: string } | { kind: 'removed' };
function entryOf(response: Response): Entry {
  const state = response.headers.get('x-retroplay-cover') || '';
  if (state === 'removed') return { kind: 'removed' };
  if (state === 'none') return { kind: 'none', lists: response.headers.get('x-retroplay-lists') || '' };
  return { kind: 'picture', source: state };
}

export interface CoverPicture { url: string; tone: string }

/** The picture's average colour, darkened: fills the card around a picture of another shape. */
function toneOf(source: CanvasImageSource): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const dark = (v: number) => Math.round(v * 0.45);
  return `rgb(${dark(r)}, ${dark(g)}, ${dark(b)})`;
}

/** A downloaded picture made `width` wide, as WebP where the browser can write it, else JPEG. */
export async function shrinkCover(blob: Blob, width = COVER_WIDTH): Promise<{ blob: Blob; tone: string }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, width / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const tone = toneOf(canvas);
    const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.82));
    const webp = await encode('image/webp');
    if (webp?.type === 'image/webp') return { blob: webp, tone };
    const jpeg = await encode('image/jpeg');
    if (!jpeg) throw new Error('picture could not be encoded');
    return { blob: jpeg, tone };
  } finally {
    bitmap.close?.();
  }
}

class CoverArt {
  /** Game id → its stored picture (object URL) and the colour around it. */
  pictures = $state.raw<Map<string, CoverPicture>>(new Map());
  /** Games looked at this session (stored entry read, or queued). */
  #seen = new Set<string>();
  #queue: Game[] = [];
  #running = 0;
  #cache: Promise<Cache | null> | null = null;
  #waitingForNetwork = false;
  /** Removed by the player or left the library: a lookup still running must not store it. */
  #dropped = new Set<string>();

  /** Lookups run only while covers are on and no game is running (they would take its time). */
  #active = false;

  picture(id: string): CoverPicture | null {
    return settings.prefs.covers ? this.pictures.get(id) || null : null;
  }

  setActive(active: boolean) {
    this.#active = active;
    if (active) this.#pump();
  }

  #open(): Promise<Cache | null> {
    if (!this.#cache) this.#cache = ('caches' in globalThis ? caches.open(COVER_CACHE) : Promise.resolve(null)).catch(() => null);
    return this.#cache;
  }

  #show(id: string, blob: Blob, tone: string) {
    const pictures = new Map(this.pictures);
    const old = pictures.get(id);
    if (old) URL.revokeObjectURL(old.url);
    pictures.set(id, { url: URL.createObjectURL(blob), tone });
    this.pictures = pictures;
  }

  #hide(id: string) {
    const old = this.pictures.get(id);
    if (!old) return;
    URL.revokeObjectURL(old.url);
    const pictures = new Map(this.pictures);
    pictures.delete(id);
    this.pictures = pictures;
  }

  /** Shows stored pictures for these games and looks up the ones never looked up. */
  async sync(games: Game[]) {
    const fresh = games.filter(game => !this.#seen.has(game.id) && coverSets(game).length);
    if (!fresh.length) return;
    for (const game of fresh) this.#seen.add(game.id);
    const cache = await this.#open();
    if (!cache) return;
    let stored: Set<string>;
    try { stored = new Set((await cache.keys()).map(request => new URL(request.url).pathname)); }
    catch { return; }
    for (const game of fresh) {
      if (!stored.has(keyOf(game.id))) { this.#enqueue(game); continue; }
      try {
        const response = await cache.match(keyOf(game.id));
        if (!response) { this.#enqueue(game); continue; }
        const entry = entryOf(response);
        if (entry.kind === 'picture') this.#show(game.id, await response.blob(), response.headers.get('x-retroplay-tone') || '');
        else if (entry.kind === 'none' && entry.lists !== COVER_LISTS) this.#enqueue(game);
      } catch {}
    }
  }

  #enqueue(game: Game) {
    this.#queue.push(game);
    this.#pump();
  }

  #pump() {
    if (!this.#active) return;
    if (globalThis.navigator?.onLine === false) {
      if (!this.#waitingForNetwork) {
        this.#waitingForNetwork = true;
        globalThis.addEventListener?.('online', () => { this.#waitingForNetwork = false; this.#pump(); }, { once: true });
      }
      return;
    }
    while (this.#running < PARALLEL && this.#queue.length) {
      const game = this.#queue.shift()!;
      this.#running++;
      void this.#fetchCover(game).finally(() => { this.#running--; this.#pump(); });
    }
  }

  async #store(id: string, body: Blob | null, headers: Record<string, string>) {
    const cache = await this.#open();
    if (!cache) return;
    await cache.put(keyOf(id), new Response(body, { headers }));
  }

  async #fetchCover(game: Game) {
    let checksums: string[] = [];
    if (game.platform !== 'ARCADE' && game.blob instanceof Blob && game.blob.size <= CHECKSUM_LIMIT) {
      try { checksums = romChecksums(game.platform, new Uint8Array(await game.blob.arrayBuffer())); } catch {}
    } else if (game.crc32) {
      checksums = [game.crc32];
    }
    let match;
    try { match = await matchCover(game, { checksums }); }
    catch { return; } // the lists could not be read: next start
    if (this.#dropped.has(game.id)) return;
    if (!match) { await this.#noPicture(game.id); return; }
    let response: Response;
    try { response = await fetch(match.url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
    catch { return; } // offline or blocked: next start
    if (response.status === 404) { await this.#noPicture(game.id); return; }
    // Server trouble, or an answer that is not a picture (a blocked request — the TV app before 1.1 —
    // a captive portal): nothing is remembered, the next start tries again.
    if (!response.ok || response.status === 204) return;
    const type = response.headers.get('content-type') || '';
    let download: Blob;
    try { download = await response.blob(); } catch { return; }
    if (!download.size || (type && !type.startsWith('image/'))) return;
    try {
      const { blob, tone } = await shrinkCover(download);
      if (this.#dropped.has(game.id)) return;
      await this.#store(game.id, blob, { 'content-type': blob.type, 'x-retroplay-cover': match.url, 'x-retroplay-tone': tone });
      this.#show(game.id, blob, tone);
    } catch {
      // Not a picture the browser can read: keep the drawn cover, try again with the next lists.
      await this.#noPicture(game.id);
    }
  }

  async #noPicture(id: string) {
    if (this.#dropped.has(id)) return;
    await this.#store(id, null, { 'x-retroplay-cover': 'none', 'x-retroplay-lists': COVER_LISTS }).catch(() => {});
  }

  /** "Kapağı kaldır": the drawn cover from now on; this game is not looked up again. */
  async remove(id: string) {
    this.#dropped.add(id);
    this.#queue = this.#queue.filter(game => game.id !== id);
    this.#hide(id);
    await this.#store(id, null, { 'x-retroplay-cover': 'removed' });
  }

  /** A game left the library: its picture goes too. */
  async forget(id: string) {
    this.#dropped.add(id);
    this.#queue = this.#queue.filter(game => game.id !== id);
    this.#hide(id);
    const cache = await this.#open();
    await cache?.delete(keyOf(id)).catch(() => false);
  }
}

export const coverArt = new CoverArt();

// Searching, filtering and sorting the library, and the short texts shown on cards. Pure.
import { isPlayablePlatform } from '../emulator-systems.js';
import { ARCADE_CORES, onlyKeysMissing, missingSummary } from '../arcade.js';
import { gameLook, SYSTEM_ORDER } from './systems.ts';
import type { ArcadeMeta, Game } from './types.ts';

export type SortKey = 'recent' | 'added' | 'name' | 'system';
export const SORTS: ReadonlyArray<{ key: SortKey; label: string }> = Object.freeze([
  { key: 'recent', label: 'Son oynanan' },
  { key: 'added', label: 'Son eklenen' },
  { key: 'name', label: 'İsme göre' },
  { key: 'system', label: 'Sisteme göre' }
]);
export const normalizeSort = (value: unknown): SortKey => (SORTS.some(s => s.key === value) ? (value as SortKey) : 'recent');

export function hasRom(game: Game): boolean {
  return typeof Blob !== 'undefined' && game.blob instanceof Blob;
}

/** A record the player can start: a supported system and the ROM bytes on this device. */
export function isPlayable(game: Game): boolean {
  return !game.demo && isPlayablePlatform(game.platform) && !game.restoredMetadataOnly && hasRom(game);
}

const fold = (text: string) => text.toLocaleLowerCase('tr-TR');

export function searchText(game: Game): string {
  return fold(`${game.title} ${gameLook(game).label} ${game.fileName || ''} ${game.arcade?.set || ''} ${game.arcade?.manufacturer || ''}`);
}

export interface FilterOptions {
  query?: string;
  /** Platform key, or 'ALL'. */
  system?: string;
  favorites?: boolean;
  /** Only games that have a save (battery save or save state). */
  withSaves?: boolean;
  saveIds?: Set<string>;
}

export function filterGames(games: Game[], { query = '', system = 'ALL', favorites = false, withSaves = false, saveIds }: FilterOptions = {}): Game[] {
  const q = fold(query.trim());
  const words = q ? q.split(/\s+/) : [];
  return games.filter(game => {
    if (system !== 'ALL' && game.platform !== system) return false;
    if (favorites && !game.favorite) return false;
    if (withSaves && !saveIds?.has(game.id)) return false;
    if (words.length) {
      const text = searchText(game);
      if (!words.every(word => text.includes(word))) return false;
    }
    return true;
  });
}

const byTitle = (a: Game, b: Game) => a.title.localeCompare(b.title, 'tr', { sensitivity: 'base', numeric: true });

export function sortGames(games: Game[], sort: SortKey): Game[] {
  const list = games.slice();
  if (sort === 'name') return list.sort(byTitle);
  if (sort === 'system') {
    const rank = (g: Game) => { const i = SYSTEM_ORDER.indexOf(g.platform); return i < 0 ? SYSTEM_ORDER.length : i; };
    return list.sort((a, b) => rank(a) - rank(b) || byTitle(a, b));
  }
  if (sort === 'added') return list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0) || byTitle(a, b));
  // recent: played games first (latest first), then the rest by when they were added.
  return list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || (b.addedAt || 0) - (a.addedAt || 0) || byTitle(a, b));
}

/** Number of games per system (only systems that have games), in display order. */
export function systemCounts(games: Game[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const game of games) counts.set(game.platform, (counts.get(game.platform) || 0) + 1);
  const keys = [...counts.keys()].sort((a, b) => {
    const ia = SYSTEM_ORDER.indexOf(a), ib = SYSTEM_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map(key => ({ key, count: counts.get(key) || 0 }));
}

/** Played games, latest first. */
export function recentlyPlayed(games: Game[], limit = Infinity): Game[] {
  return games.filter(g => !g.demo && g.lastPlayed).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, limit);
}

/** The game the home screen offers to continue: the last one played that can still start. */
export function continueCandidate(games: Game[]): Game | null {
  return recentlyPlayed(games).find(isPlayable) || null;
}

export interface CardContext {
  biosIds: Set<string>;
  games: Game[];
}

export function arcadeParentInstalled(arcade: ArcadeMeta | undefined, games: Game[]): boolean {
  return !arcade?.parent || arcade.status !== 'needs-parent' || games.some(g => g.platform === 'ARCADE' && g.arcade?.set === arcade.parent && hasRom(g));
}

/** One line about an arcade set's state ("FinalBurn Neo · tam set", "neogeo.zip gerekli" …). */
export function arcadeCardLabel(arcade: ArcadeMeta, { biosIds, games }: CardContext): string {
  if (arcade.bios && !biosIds.has(`${arcade.bios}.zip`)) return `${arcade.bios}.zip gerekli`;
  if (arcade.status === 'complete') return `${(ARCADE_CORES as Record<string, { label: string }>)[arcade.core]?.label || 'Arcade'} · tam set`;
  if (arcade.status === 'needs-parent') return arcadeParentInstalled(arcade, games) ? `Ana set ${arcade.parent} ile` : `Ana set ${arcade.parent}.zip gerekli`;
  if (onlyKeysMissing(arcade)) return arcade.cps2Key === true ? 'Eksik set · CPS2 anahtarı yok' : 'Eksik set · şifre anahtarı yok';
  return `Eksik set · ${missingSummary(arcade)}`;
}

export type CardTone = 'ok' | 'warn' | 'muted';

/** The status line of a card and how it should look. */
export function cardStatus(game: Game, ctx: CardContext): { text: string; tone: CardTone } {
  const look = gameLook(game);
  if (game.restoredMetadataOnly) return { text: 'Yedek kaydı · ROM yok', tone: 'warn' };
  if (game.platform === 'ARCADE' && game.arcade) {
    const text = arcadeCardLabel(game.arcade, ctx);
    const ok = game.arcade.status === 'complete' || (game.arcade.status === 'needs-parent' && arcadeParentInstalled(game.arcade, ctx.games));
    const biosOk = !game.arcade.bios || ctx.biosIds.has(`${game.arcade.bios}.zip`);
    return { text, tone: ok && biosOk ? 'ok' : 'warn' };
  }
  if (!look.playable) return { text: `${look.label} henüz desteklenmiyor`, tone: 'muted' };
  if (!hasRom(game)) return { text: 'ROM yok', tone: 'warn' };
  return { text: `${look.label} · Oynatılabilir dosya`, tone: 'ok' };
}

/** Second line under a card title: year and maker when known, else the status line. */
export function cardMeta(game: Game, ctx: CardContext): string {
  const status = cardStatus(game, ctx);
  if (status.tone !== 'ok') return status.text;
  const parts: string[] = [];
  if (game.year) parts.push(String(game.year));
  if (game.arcade?.manufacturer) parts.push(game.arcade.manufacturer);
  return parts.length ? parts.join(' · ') : status.text;
}

// Import, step 2: the review list the user confirms, then storing the chosen files.
import { loadCatalogs, describeArcadeStatus } from '../arcade.js';
import { app } from './app-state.svelte.ts';
import { classifyImport } from '../import-match.js';
import { platformInfo } from '../platforms.js';
import * as db from './db.ts';
import { library } from './library.svelte.ts';
import { arcadeRecord } from './arcade-records.ts';
import { scanFiles, type ReviewItem } from './import-scan.ts';
import { formatBytes } from './format.ts';
import { showToast } from './toast.svelte.ts';
import type { Game } from './types.ts';

export type ImportPhase = 'idle' | 'scanning' | 'review' | 'importing' | 'done';

export function storageErrorMessage(error: unknown): string {
  const e = error as { name?: string; message?: string };
  if (e?.name === 'QuotaExceededError') return 'Tarayıcı depolama alanı dolu';
  if (e?.name === 'DataCloneError') return 'Dosya tarayıcı depolamasına aktarılamadı';
  return e?.message || 'Bilinmeyen depolama hatası';
}

const newId = () => `rom-${typeof globalThis.crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

export interface CommitSummary { added: number; skipped: number; failed: number; bios: number; games: Game[] }

class Importer {
  phase = $state<ImportPhase>('idle');
  items = $state.raw<ReviewItem[]>([]);
  scanDone = $state(0);
  scanTotal = $state(0);
  progress = $state(0);
  progressLabel = $state('');
  /** Result lines (also used by the end-to-end tests). */
  results = $state('');
  summary = $state<CommitSummary | null>(null);
  ignored = $state(0);
  source = $state('');
  freeBytes = $state<number | null>(null);
  #scanLog: string[] = [];
  #generation = 0;

  get selected(): ReviewItem[] { return this.items.filter(item => item.selectable && item.selected); }
  get selectedBytes(): number { return this.selected.reduce((n, item) => n + item.size, 0); }

  reset() {
    this.#generation++;
    this.phase = 'idle';
    this.items = [];
    this.results = '';
    this.summary = null;
    this.ignored = 0;
    this.source = '';
    this.progress = 0;
    this.#scanLog = [];
  }

  /** Adds files to the review list (a second choice adds to the first one). */
  async add(files: File[] | FileList, { folder = false, source = '' }: { folder?: boolean; source?: string } = {}) {
    const list = [...files];
    if (!list.length) return;
    if (this.phase === 'done' || this.phase === 'importing') this.reset();
    const generation = ++this.#generation;
    const previous = this.phase === 'review' ? this.items : [];
    this.phase = 'scanning';
    this.source = source || (folder ? 'Klasör' : 'Seçilen dosyalar');
    this.scanDone = 0;
    this.scanTotal = list.length;
    void this.estimate();
    const games = [...library.games, ...previous.filter(item => item.selected && item.hash).map(item => ({ id: item.key, title: item.title, platform: item.platform, contentHash: item.hash, blob: item.file } as Game))];
    const result = await scanFiles(list, { games, biosIds: library.biosIds, loadCatalogs }, {
      folder,
      onProgress: (done, total) => { if (generation === this.#generation) { this.scanDone = done; this.scanTotal = total; } }
    });
    if (generation !== this.#generation) return;
    this.#scanLog.push(...result.log);
    this.ignored += result.ignored;
    this.items = [...previous, ...result.items];
    this.phase = 'review';
  }

  toggle(key: string, on?: boolean) {
    this.items = this.items.map(item => (item.key === key && item.selectable ? { ...item, selected: on ?? !item.selected } : item));
  }

  remove(key: string) {
    this.items = this.items.filter(item => item.key !== key);
    if (!this.items.length) this.reset();
  }

  async estimate() {
    try {
      const estimate = await navigator.storage?.estimate?.();
      this.freeBytes = estimate?.quota ? Math.max(0, estimate.quota - (estimate.usage || 0)) : null;
    } catch { this.freeBytes = null; }
  }

  /** Stores the chosen items. */
  async commit(): Promise<CommitSummary> {
    const items = this.items;
    const generation = ++this.#generation;
    this.phase = 'importing';
    const lines: string[] = [...this.#scanLog];
    const summary = await storeItems(items, lines, (done, total, label) => {
      if (generation !== this.#generation) return;
      this.progress = total ? done / total : 1;
      this.progressLabel = label;
    });
    if (generation !== this.#generation) return summary;
    this.results = `Tamamlandı: ${summary.added} · Atlandı: ${summary.skipped} · Hata: ${summary.failed}\n${lines.join('\n')}\n`;
    this.summary = summary;
    this.phase = 'done';
    if (summary.added) showToast(summary.bios && summary.bios === summary.added ? `${summary.bios} BIOS dosyası eklendi.` : `${summary.added} dosya eklendi.`);
    // Now there is something to keep: ask again for storage the browser will not clear.
    if (summary.added && app.persisted !== true) void app.requestPersistence();
    else showToast(summary.failed ? 'Dosyalar eklenemedi. Ayrıntılar içe aktarma ekranında.' : 'Eklenecek yeni dosya yoktu.', 'error');
    return summary;
  }

  /** Scans and stores files without the review screen (BIOS chosen in Settings or in the player). */
  async importDirect(files: File[] | FileList): Promise<CommitSummary & { results: string }> {
    const result = await scanFiles([...files], { games: library.games, biosIds: library.biosIds, loadCatalogs });
    const lines = [...result.log];
    const summary = await storeItems(result.items, lines, () => {});
    return { ...summary, results: lines.join('\n') };
  }
}

async function storeItems(items: ReviewItem[], lines: string[], onProgress: (done: number, total: number, label: string) => void): Promise<CommitSummary> {
  const summary: CommitSummary = { added: 0, skipped: 0, failed: 0, bios: 0, games: [] };
  const work = items.filter(item => item.selectable && item.selected);
  const total = work.reduce((n, item) => n + item.size, 0);
  let doneBytes = 0;
  let done = 0;
  for (const item of items) {
    if (!item.selectable || !item.selected) {
      summary.skipped++;
      lines.push(`Atlandı: ${item.fileName} — ${item.skipReason || 'seçilmedi'}`);
      continue;
    }
    onProgress(done, work.length, `İşleniyor ${done + 1}/${work.length} · ${formatBytes(doneBytes)} / ${formatBytes(total)}`);
    try {
      if (item.kind === 'bios' && item.bios) {
        await db.putBios({ id: `${item.bios.set}.zip`, set: item.bios.set, label: item.bios.label, fileName: item.file.name, size: item.file.size, blob: item.file, missing: item.bios.missing, addedAt: Date.now() });
        await library.refreshBios();
        summary.added++;
        summary.bios++;
        lines.push(`BIOS eklendi: ${item.bios.set}.zip — ${item.bios.label}${item.bios.missing.length ? ` · eksik dosya: ${item.bios.missing.join(', ')}` : ' · kullanıma hazır'}`);
      } else {
        const game = await storeGame(item, lines);
        if (game) { summary.added++; summary.games.push(game); } else summary.skipped++;
      }
    } catch (error) {
      summary.failed++;
      lines.push(`Hata: ${item.fileName} — ${storageErrorMessage(error)}`);
    } finally {
      done++;
      doneBytes += item.size;
      onProgress(done, work.length, `İşlenen ${done}/${work.length} · ${formatBytes(doneBytes)}`);
    }
  }
  return summary;
}

async function storeGame(item: ReviewItem, lines: string[]): Promise<Game | null> {
  const file = item.file;
  // The library may have changed since the scan (another import): check duplicates again.
  const match = classifyImport(library.games, item.hash) as { action: string; game?: Game };
  if (match.action === 'duplicate') { lines.push(`Atlandı: ${item.fileName} — aynı içerik kütüphanede zaten var`); return null; }
  const arcadeMeta = item.arcade ? arcadeRecord(item.arcade) : undefined;
  if (match.action === 'relink' && match.game) {
    // A metadata-only record restored from a backup gets its ROM back; favourites, play history
    // and the record ID (and therefore its saves) are kept.
    const previous = match.game;
    const platform = arcadeMeta ? 'ARCADE' : previous.platform && previous.platform !== 'UNKNOWN' ? previous.platform : item.platform;
    const relinked: Game = { ...previous, platform, fileName: file.name, size: file.size, sizeLabel: formatBytes(file.size), blob: file, romValidation: item.romValidation, restoredMetadataOnly: false, status: 'imported', ...(item.crc32 ? { crc32: item.crc32 } : {}), ...(arcadeMeta ? { arcade: arcadeMeta } : {}) };
    await library.save(relinked);
    lines.push(`Yedek kaydına bağlandı: ${item.fileName}`);
    return relinked;
  }
  const platform = item.platform;
  const info = platformInfo(platform);
  const game: Game = {
    id: newId(), title: item.title || file.name, platform,
    year: item.arcade ? Number(item.arcade.year) || null : null,
    genre: item.arcade ? 'Arcade' : 'Bilinmiyor',
    ...(arcadeMeta ? { arcade: arcadeMeta } : {}),
    symbol: info.logo, coverBg: info.color, coverGlow: info.glow,
    fileName: file.name, size: file.size, sizeLabel: formatBytes(file.size), contentHash: item.hash, blob: file,
    romValidation: item.romValidation, addedAt: Date.now(), favorite: false, demo: false, playable: false, status: 'imported',
    ...(item.crc32 ? { crc32: item.crc32 } : {})
  };
  const staleCopy = arcadeMeta && arcadeMeta.status !== 'incomplete'
    ? library.games.find(g => g.platform === 'ARCADE' && g.arcade?.set === arcadeMeta.set && g.arcade?.status === 'incomplete')
    : null;
  await library.save(game);
  if (arcadeMeta && item.arcade) {
    const biosInstalled = !arcadeMeta.bios || library.biosIds.has(`${arcadeMeta.bios}.zip`);
    const parentInstalled = !arcadeMeta.parent || arcadeMeta.status !== 'needs-parent' || library.games.some(g => g.platform === 'ARCADE' && g.arcade?.set === arcadeMeta.parent && g.blob instanceof Blob);
    lines.push(`Eklendi: ${item.fileName} — ${item.arcade.title} · ${describeArcadeStatus(arcadeMeta, { biosInstalled, parentInstalled })}${staleCopy ? ' · aynı oyunun eksik eski kopyası kütüphanede; onu oyunun sayfasındaki "Kütüphaneden kaldır" ile silebilirsin' : ''}`);
  } else {
    lines.push(`Eklendi: ${item.fileName}${item.hash ? ' — içerik parmak izi alındı' : ''}`);
  }
  return game;
}

export const importer = new Importer();

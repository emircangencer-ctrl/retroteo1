// Library backup (JSON, schema 1): names, systems, favourites, play history and file fingerprints.
// ROM files are not in it. Restoring adds records that are not in the library yet and never
// overwrites existing ones; a restored record waits for its ROM (relinked on import by content).
import { validBackup } from '../library-backup.js';
import { allGames } from './db.ts';
import { library } from './library.svelte.ts';
import { APP_VERSION } from './app-state.svelte.ts';
import { downloadBlob } from './exports.ts';
import { formatBytes } from './format.ts';
import { confirmDialog, alertDialog } from './dialog.svelte.ts';
import { showToast } from './toast.svelte.ts';
import type { Game } from './types.ts';

export function backupMetadata(game: Game): Omit<Game, 'blob'> {
  const { blob: _blob, ...metadata } = game;
  return metadata;
}

export function exportLibraryBackup() {
  try {
    const games = library.games.filter(g => !g.demo);
    const payload = { app: 'RetroPlay', backupType: 'library-metadata', schemaVersion: 1, appVersion: APP_VERSION, createdAt: new Date().toISOString(), gameCount: games.length, games: games.map(backupMetadata) };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `RetroPlay-Library-${new Date().toISOString().slice(0, 10)}-v${APP_VERSION}.json`);
    showToast('Kütüphane yedeği hazırlandı. ROM dosyaları bu yedeğe dahil değildir.');
  } catch (error) {
    showToast(`Yedek oluşturulamadı: ${(error as Error)?.message || error}`, 'error');
  }
}

export async function restoreLibraryBackup(file: File | null | undefined) {
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Yedek 20 MB sınırını aşıyor.');
    const data = JSON.parse(await file.text());
    if (!validBackup(data)) throw new Error('Yedek biçimi veya şema sürümü geçersiz. Mevcut kayıtlar değiştirilmedi.');
    const existing = new Set((await allGames()).map(g => g.id));
    const candidates = (data.games as Game[]).filter(g => !existing.has(g.id));
    const duplicates = data.games.length - candidates.length;
    const total = candidates.reduce((n, g) => n + (g.size || 0), 0);
    const ok = await confirmDialog({
      title: 'Yedek geri yüklensin mi?',
      message: 'Bu JSON yedeğinde ROM dosyalarının kendisi yok: geri yüklenen kayıtlar, ROM dosyası tekrar eklenene kadar yalnızca bilgi kaydıdır. Mevcut kayıtların üzerine yazılmaz.',
      details: [`Yedek tarihi: ${data.createdAt || 'bilinmiyor'}`, `Yedekteki kayıt: ${data.games.length}`, `Eklenecek yeni kayıt: ${candidates.length}`, `Zaten var, atlanacak: ${duplicates}`, `İlgili ROM boyutları: ${formatBytes(total)}`],
      confirmLabel: candidates.length ? `${candidates.length} kaydı ekle` : 'Tamam'
    });
    if (!ok || !candidates.length) return;
    let added = 0, failed = 0;
    for (const raw of candidates) {
      const playtime = Number(raw.playtimeMs);
      const record: Game = { ...raw, blob: undefined, restoredMetadataOnly: true, addedAt: Number(raw.addedAt) || Date.now(), ...(Number.isFinite(playtime) && playtime > 0 ? { playtimeMs: playtime } : { playtimeMs: undefined }) };
      try { await library.save(record); added++; } catch { failed++; }
    }
    showToast(`Geri yükleme tamamlandı: ${added} eklendi, ${duplicates} çakışma atlandı, ${failed} hata.`, failed ? 'error' : 'success');
    if (failed) await alertDialog({ title: 'Bazı kayıtlar geri yüklenemedi', message: `Sağlıklı kayıtlar korundu. Sonuç: ${added} eklendi, ${failed} hata.` });
  } catch (error) {
    showToast(`Yedek geri yüklenemedi: ${(error as Error)?.message || error}`, 'error');
  }
}

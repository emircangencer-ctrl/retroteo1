// Downloads: a game's ROM file and its in-game save (.srm), the library backup.
import { getBatterySave } from './db.ts';
import { safeFilename, formatBytes } from './format.ts';
import { showToast } from './toast.svelte.ts';
import { tv } from './tv.svelte.ts';
import type { Game } from './types.ts';

export function downloadBlob(blob: Blob, filename: string) {
  // The TV app's WebView has nowhere to save a file (the buttons are hidden there; this is a guard).
  if (tv.bridge) throw new Error('TV uygulaması dosya kaydedemez; bunu telefonda veya bilgisayarda yap');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportRom(game: Game) {
  if (!(game.blob instanceof Blob)) { showToast('Bu oyun için yerel ROM içeriği bulunamadı. Dosyayı yeniden içe aktar.', 'error'); return; }
  try {
    downloadBlob(game.blob, safeFilename(game.fileName || `${game.title}.rom`));
    showToast('ROM dosyası indiriliyor.');
  } catch (error) {
    showToast(`ROM dışa aktarılamadı: ${(error as Error)?.message || error}`, 'error');
  }
}

export async function exportSram(game: Game) {
  try {
    const record = await getBatterySave(game.id);
    if (!record?.bytes || !record.byteLength) { showToast('Bu oyun için henüz oyun içi kayıt (SRAM) yok. Oyunda kayıt yaptıktan sonra tekrar dene.', 'error'); return; }
    const bytes = record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes);
    downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), `${safeFilename(game.title || game.fileName || 'retroplay-save')}.srm`);
    showToast(`Oyun içi kayıt indirildi (${formatBytes(bytes.byteLength)}).`);
  } catch (error) {
    showToast(`Kayıt indirilemedi: ${(error as Error)?.message || error}`, 'error');
  }
}

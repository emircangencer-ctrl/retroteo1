// Import, step 1: look at the chosen files and say what each one is before anything is stored.
// Console ROMs inside a zip are taken out; arcade sets and BIOS files stay zipped and are checked
// against the cores' game lists. Nothing is written here (see importer.svelte.ts for step 2).
import { inspectNesRom, diagnoseSuperMarioBros3Rom, crc32 } from '../nes-rom.js';
import { extractRomFilesFromZip, readZipDirectory } from '../zip-rom.js';
import { identifyArcadeZip, describeArcadeStatus } from '../arcade.js';
import { classifyImport } from '../import-match.js';
import { detectRomPlatform, isMegaDriveHeader } from '../rom-detect.js';
import { platformInfo } from '../platforms.js';
import { systemLook } from './systems.ts';
import { fileExt, formatBytes, hex32, titleFromFileName } from './format.ts';
import type { IdentifiedArcade } from './arcade-records.ts';
import type { Game, RomValidation } from './types.ts';

export const ROM_EXTENSIONS: ReadonlySet<string> = new Set(['nes', 'sfc', 'smc', 'md', 'gen', 'bin', 'z64', 'n64', 'v64', 'cue', 'iso']);
const CONSOLE_EXTS: ReadonlySet<string> = new Set(['nes', 'sfc', 'smc', 'md', 'gen']);
/** Files a folder scan looks at; everything else in the folder is passed over quietly. */
export const SCAN_EXTENSIONS: ReadonlySet<string> = new Set([...ROM_EXTENSIONS, 'zip']);
const CRC_LIMIT = 16 * 1024 * 1024;
const HASH_LIMIT = 256 * 1024 * 1024;

export type ItemKind = 'rom' | 'arcade' | 'bios' | 'skip';
export type ItemTone = 'ok' | 'warn' | 'skip';

export interface ReviewItem {
  key: string;
  file: File;
  /** File name as chosen (or as stored inside the zip). */
  fileName: string;
  /** Shown as the item's title (file name without extension, or the arcade game's name). */
  name: string;
  size: number;
  kind: ItemKind;
  tone: ItemTone;
  platform: string;
  title: string;
  headline: string;
  note: string;
  meta: string;
  selectable: boolean;
  selected: boolean;
  hash: string | null;
  crc32: string;
  romValidation: RomValidation | null;
  arcade: (IdentifiedArcade & { kind?: string; title?: string; label?: string }) | null;
  relink: Game | null;
  bios: { set: string; label: string; missing: string[] } | null;
  /** Why the file will not be added (result log). */
  skipReason: string;
  /** The zip a console ROM was taken out of. */
  fromZip: string;
}

export interface ScanContext {
  games: Game[];
  biosIds: Set<string>;
  loadCatalogs: () => Promise<unknown>;
}

export interface ScanResult { items: ReviewItem[]; log: string[]; ignored: number }

let counter = 0;
const nextKey = () => `item-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export async function sha256(file: Blob): Promise<string | null> {
  if (!globalThis.crypto?.subtle || file.size > HASH_LIMIT) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function base(file: File, fileName = file.name): ReviewItem {
  return {
    key: nextKey(), file, fileName, name: fileName.replace(/\.[^.]+$/, '') || fileName, size: file.size,
    kind: 'skip', tone: 'skip', platform: '', title: '', headline: '', note: '', meta: formatBytes(file.size),
    selectable: false, selected: false, hash: null, crc32: '', romValidation: null, arcade: null, relink: null, bios: null, skipReason: '', fromZip: ''
  };
}

function skip(item: ReviewItem, headline: string, reason: string, note = ''): ReviewItem {
  return { ...item, kind: 'skip', tone: 'skip', headline, note, skipReason: reason, selectable: false, selected: false };
}

/** Looks at one console ROM file (not a zip). `pending` holds hashes of earlier items in this batch. */
export async function scanRom(file: File, ctx: ScanContext, pending: Map<string, ReviewItem>, fromZip = ''): Promise<ReviewItem> {
  const ext = fileExt(file.name);
  let item = { ...base(file), fromZip };
  if (!ROM_EXTENSIONS.has(ext)) return skip(item, 'Tanınmayan dosya türü · eklenmeyecek', 'tanınmayan uzantı');
  if (file.size === 0) return skip(item, 'Dosya boş · eklenmeyecek', 'dosya boş');

  const bytes = file.size <= CRC_LIMIT ? new Uint8Array(await file.arrayBuffer()) : null;
  const header = bytes ? bytes.subarray(0, 0x200) : new Uint8Array(await file.slice(0, 0x200).arrayBuffer());
  let romValidation: RomValidation | null = null;
  if (ext === 'nes') {
    romValidation = inspectNesRom(header.subarray(0, 16), { totalSize: file.size }) as RomValidation;
    if (!romValidation.valid) return skip(item, 'NES · geçersiz dosya · eklenmeyecek', `NES doğrulaması başarısız: ${romValidation.reason}`, String(romValidation.reason || ''));
  }
  const platform = detectRomPlatform(file.name, header);
  const look = systemLook(platform);
  const crc = bytes ? hex32(crc32(bytes)) : '';
  item = { ...item, platform, crc32: crc, romValidation, title: titleFromFileName(file.name) };
  const metaParts = [crc ? `CRC32 ${crc}` : '', formatBytes(file.size)].filter(Boolean);
  if (ext === 'bin' && platform === 'MD' && isMegaDriveHeader(header)) metaParts.unshift(`${file.name} · içerikten tanındı`);
  if (fromZip) metaParts.push(`${fromZip} içinden`);
  item.meta = metaParts.join(' · ');

  if (platform === 'UNKNOWN') return skip(item, 'Sistem tanınmadı · eklenmeyecek', 'sistem tanınmadı', ext === 'bin' ? '.bin dosyası yalnızca Mega Drive (SEGA) başlığı taşıyorsa tanınır.' : '');
  if (!look.playable) return skip(item, `${platformInfo(platform).label} henüz desteklenmiyor · eklenmeyecek`, `${look.label} henüz desteklenmiyor`);

  const hash = await sha256(file);
  item.hash = hash;
  if (hash && pending.has(hash)) return skip(item, 'Bu seçimde iki kez var · bir kez eklenecek', 'aynı dosya bu seçimde zaten var');
  const match = classifyImport(ctx.games, hash) as { action: string; game?: Game };
  if (match.action === 'duplicate') return skip(item, 'Zaten kütüphanede · eklenmeyecek', 'aynı içerik kütüphanede zaten var', `“${match.game?.title}” ile aynı dosya.`);

  const ready: ReviewItem = { ...item, kind: 'rom', tone: 'ok', selectable: true, selected: true, headline: `${look.label} · Oynatılabilir dosya` };
  if (match.action === 'relink' && match.game) {
    ready.relink = match.game;
    ready.headline = `${look.label} · Yedek kaydına bağlanacak`;
    ready.note = `“${match.game.title}” kaydına ROM geri eklenir; favori ve oyun geçmişi korunur.`;
  }
  if (platform === 'NES' && bytes && romValidation) {
    const smb3 = diagnoseSuperMarioBros3Rom(bytes, file.name, romValidation) as { status: string; recognizedRelease?: string } | null;
    if (smb3?.status === 'reference-match') ready.headline = `NES · Doğrulanmış döküm (${smb3.recognizedRelease})`;
    else if (smb3) {
      ready.tone = 'warn';
      ready.headline = 'NES · Tanınmayan döküm';
      ready.note = 'Temiz Super Mario Bros. 3 sürümleriyle eşleşmiyor; hack ya da bozuk olabilir. Grafik hataları görülebilir. İlk açılışta onayın sorulur.';
    }
  }
  if (hash) pending.set(hash, ready);
  return ready;
}

/** Looks at one zip: a console ROM archive, an arcade set or a BIOS. */
async function scanZip(file: File, ctx: ScanContext, pending: Map<string, ReviewItem>, state: { catalogs: unknown; catalogError: Error | null }, log: string[]): Promise<ReviewItem[]> {
  const item = base(file);
  let entries: Array<{ name: string }>;
  try { entries = await readZipDirectory(file); }
  catch (error) { return [skip(item, 'ZIP açılamadı · eklenmeyecek', `ZIP hatası: ${(error as Error)?.message || error}`, String((error as Error)?.message || error))]; }

  if (!entries.some(entry => CONSOLE_EXTS.has(fileExt(entry.name)))) {
    if (!state.catalogs && !state.catalogError) {
      try { state.catalogs = await ctx.loadCatalogs(); } catch (error) { state.catalogError = error as Error; }
    }
    const found = state.catalogs ? identifyArcadeZip(file.name, entries, state.catalogs) as (IdentifiedArcade & { kind: string; title: string; label: string; missing: string[] }) | null : null;
    if (found?.kind === 'bios') {
      const missing = found.missing || [];
      return [{
        ...item, kind: 'bios', tone: missing.length ? 'warn' : 'ok', platform: 'BIOS', title: `${found.set}.zip`, name: `${found.set}.zip`,
        headline: `BIOS · ${found.label}`, note: missing.length ? `Eksik dosya: ${missing.join(', ')}` : 'Kullanıma hazır.',
        meta: `${file.name} · ${formatBytes(file.size)}`, selectable: true, selected: true, bios: { set: found.set, label: found.label, missing }
      }];
    }
    if (found?.kind === 'game') {
      const biosInstalled = !found.bios || ctx.biosIds.has(`${found.bios}.zip`);
      const parentInstalled = !found.parent || found.status !== 'needs-parent' || ctx.games.some(g => g.platform === 'ARCADE' && g.arcade?.set === found.parent && g.blob instanceof Blob);
      const status = describeArcadeStatus(found, { biosInstalled, parentInstalled }) as string;
      const playable = (found.status === 'complete' || (found.status === 'needs-parent' && parentInstalled)) && biosInstalled;
      const hash = await sha256(file);
      const ready: ReviewItem = {
        ...item, kind: 'arcade', tone: playable ? 'ok' : 'warn', platform: 'ARCADE', title: found.title, name: found.title,
        headline: `Arcade · ${status}`, meta: [file.name, found.renamedFrom ? `${found.set}.zip olarak tanındı` : '', formatBytes(file.size)].filter(Boolean).join(' · '),
        selectable: true, selected: true, arcade: found, hash
      };
      if (found.status === 'incomplete') ready.note = 'Set bu çekirdek sürümüyle uyuşmuyor; eklenir ama açılmayabilir. Doğru sürümdeki seti eklemen önerilir.';
      else if (!biosInstalled) ready.note = `Açılması için ${found.bios}.zip BIOS dosyası da gerekli; onu da ekleyebilirsin.`;
      if (hash && pending.has(hash)) return [skip(ready, 'Bu seçimde iki kez var · bir kez eklenecek', 'aynı dosya bu seçimde zaten var')];
      const match = classifyImport(ctx.games, hash) as { action: string; game?: Game };
      if (match.action === 'duplicate') return [skip(ready, 'Zaten kütüphanede · eklenmeyecek', 'aynı içerik kütüphanede zaten var', `“${match.game?.title}” ile aynı dosya.`)];
      if (match.action === 'relink' && match.game) {
        ready.relink = match.game;
        ready.note = `“${match.game.title}” kaydına ROM geri eklenir; favori ve oyun geçmişi korunur.`;
      }
      if (hash) pending.set(hash, ready);
      return [ready];
    }
  }

  if (!entries.some(entry => ROM_EXTENSIONS.has(fileExt(entry.name)))) {
    const why = state.catalogError ? `Arcade oyun listesi yüklenemedi (${state.catalogError.message}); bağlantı varken yeniden dene.` : 'İçinde ROM yok ve bir arcade seti ya da BIOS olarak da tanınmadı.';
    return [skip(item, 'ZIP içinde desteklenen oyun yok · eklenmeyecek', 'ZIP içinde desteklenen ROM yok', why)];
  }
  let extracted: File[];
  try { extracted = await extractRomFilesFromZip(file); }
  catch (error) {
    const message = `${(error as Error)?.message || error}${state.catalogError ? ` (arcade oyun listesi yüklenemedi: ${state.catalogError.message})` : ''}`;
    return [skip(item, 'ZIP açılamadı · eklenmeyecek', `ZIP hatası: ${message}`, message)];
  }
  if (!extracted.length) return [skip(item, 'ZIP içinde desteklenen oyun yok · eklenmeyecek', 'ZIP içinde desteklenen ROM yok', 'İçinde ROM yok ve bir arcade seti ya da BIOS olarak da tanınmadı.')];
  log.push(`ZIP açıldı: ${file.name} — ${extracted.length} desteklenen ROM bulundu`);
  const items: ReviewItem[] = [];
  for (const inner of extracted) items.push(await scanRom(inner, ctx, pending, file.name));
  return items;
}

/**
 * Looks at the chosen files. `folder`: files came from a folder scan, so files that are clearly no
 * game (pictures, text …) are passed over and only counted.
 */
export async function scanFiles(files: File[], ctx: ScanContext, { folder = false, onProgress }: { folder?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<ScanResult> {
  const log: string[] = [];
  const items: ReviewItem[] = [];
  const pending = new Map<string, ReviewItem>();
  const state = { catalogs: null as unknown, catalogError: null as Error | null };
  let ignored = 0;
  const list = folder ? files.filter(file => { const keep = SCAN_EXTENSIONS.has(fileExt(file.name)); if (!keep) ignored++; return keep; }) : files;
  let done = 0;
  for (const file of list) {
    try {
      if (fileExt(file.name) === 'zip') items.push(...await scanZip(file, ctx, pending, state, log));
      else items.push(await scanRom(file, ctx, pending));
    } catch (error) {
      items.push(skip(base(file), 'Okunamadı · eklenmeyecek', `okunamadı: ${(error as Error)?.message || error}`, String((error as Error)?.message || error)));
    }
    onProgress?.(++done, list.length);
  }
  return { items, log, ignored };
}

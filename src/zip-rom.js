const SUPPORTED_ROM_EXTENSIONS = new Set(['nes','sfc','smc','md','gen','bin','z64','n64','v64','cue','iso']);
const MAX_ENTRIES = 1000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const decoder = new TextDecoder('utf-8');
const legacyDecoder = new TextDecoder('windows-1252');

function u16(v, o) { if (o < 0 || o + 2 > v.byteLength) throw new Error('ZIP arşivi bozuk veya kesik.'); return v.getUint16(o, true); }
function u32(v, o) { if (o < 0 || o + 4 > v.byteLength) throw new Error('ZIP arşivi bozuk veya kesik.'); return v.getUint32(o, true); }
function extOf(name) { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Inflates ZIP deflate data incrementally and never stores more than the
 * declared, capped output size. This prevents trusting a forged ZIP size
 * field and then allocating an unbounded decompression result.
 */
async function inflateRaw(bytes, expectedSize, name) {
  if (expectedSize > MAX_ENTRY_BYTES) throw new Error(`${name}: açılmış dosya boyutu sınırı aşıyor.`);
  if (typeof DecompressionStream !== 'function') throw new Error('Bu tarayıcı ZIP içindeki sıkıştırılmış dosyaları açmayı desteklemiyor. Tarayıcıyı güncelle veya ZIP içindeki ROM dosyasını çıkarıp doğrudan yükle.');
  let stream;
  try { stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
  catch { throw new Error('Tarayıcı deflate-raw ZIP sıkıştırmasını desteklemiyor. ZIP içindeki ROM dosyasını çıkarıp doğrudan yükle.'); }

  const reader = stream.getReader();
  const output = new Uint8Array(expectedSize);
  let written = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (written + value.length > expectedSize || written + value.length > MAX_ENTRY_BYTES) {
        try { await reader.cancel(); } catch {}
        throw new Error(`${name}: açılmış veri, ZIP başlığında bildirilen boyutu aşıyor.`);
      }
      output.set(value, written);
      written += value.length;
    }
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (written !== expectedSize) throw new Error(`${name}: açılmış boyut beklenen değerle eşleşmiyor.`);
  return output;
}

/** Extracts supported ROM files from a standard, non-encrypted ZIP in memory. No files are written to disk. */
export async function extractRomFilesFromZip(file) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 22) throw new Error('Geçerli ZIP dosyası seçilmedi veya dosya çok kısa.');
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error(`ZIP arşivi ${Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024)} MiB sınırını aşıyor.`);

  const archive = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const min = Math.max(0, archive.length - 22 - 65535);
  let eocd = -1;
  for (let i = archive.length - 22; i >= min; i--) {
    if (u32(view, i) !== 0x06054b50) continue;
    const candidateCommentLength = u16(view, i + 20);
    if (i + 22 + candidateCommentLength === archive.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Geçerli ZIP bitiş kaydı bulunamadı. Dosya bozuk veya ZIP64 biçiminde olabilir.');

  const disk = u16(view, eocd + 4), centralDisk = u16(view, eocd + 6);
  const entriesOnDisk = u16(view, eocd + 8), entriesTotal = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12), centralOffset = u32(view, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entriesTotal) throw new Error('Çok parçalı ZIP arşivleri desteklenmiyor.');
  if (entriesTotal === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) throw new Error('ZIP64 arşivleri bu sürümde desteklenmiyor. Standart ZIP olarak yeniden sıkıştır.');
  if (entriesTotal > MAX_ENTRIES) throw new Error(`ZIP içinde çok fazla dosya var (sınır ${MAX_ENTRIES}).`);

  const centralEnd = centralOffset + centralSize;
  if (centralOffset < 0 || centralEnd > eocd || centralEnd < centralOffset) throw new Error('ZIP dizin bilgileri dosya sınırlarının dışında.');

  const results = [];
  let cursor = centralOffset;
  let totalExpanded = 0;
  for (let i = 0; i < entriesTotal; i++) {
    if (cursor + 46 > centralEnd || u32(view, cursor) !== 0x02014b50) throw new Error('ZIP dosya dizini bozuk.');
    const flags = u16(view, cursor + 8), method = u16(view, cursor + 10);
    const expectedCrc = u32(view, cursor + 16), compressedSize = u32(view, cursor + 20), uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28), extraLength = u16(view, cursor + 30), entryCommentLength = u16(view, cursor + 32);
    const diskStart = u16(view, cursor + 34);
    const localOffset = u32(view, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (end > centralEnd) throw new Error('ZIP dosya adı veya dizin kaydı kesilmiş.');
    const rawName = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    let name;
    try { name = (flags & 0x0800) ? decoder.decode(rawName) : legacyDecoder.decode(rawName); }
    catch { throw new Error('ZIP içinde geçersiz dosya adı kodlaması var.'); }
    cursor = end;
    if (!name || name.endsWith('/') || name.endsWith('\\')) continue;
    const ext = extOf(name);
    if (!SUPPORTED_ROM_EXTENSIONS.has(ext)) continue;

    if (diskStart !== 0) throw new Error(`${name}: başka disk parçasına ait ZIP girdileri desteklenmiyor.`);
    if (flags & 0x0041) throw new Error(`ZIP şifreli: ${name}. Şifreli arşivler desteklenmiyor.`);
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64 dosya girdileri bu sürümde desteklenmiyor.');
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`ZIP içindeki ${name} dosyası 256 MiB sınırını aşıyor.`);
    totalExpanded += uncompressedSize;
    if (totalExpanded > MAX_TOTAL_BYTES) throw new Error('ZIP içindeki açılmış ROM toplamı 512 MiB sınırını aşıyor.');
    if (method !== 0 && method !== 8) throw new Error(`${name}: desteklenmeyen ZIP sıkıştırma yöntemi (${method}).`);
    if (localOffset + 30 > centralOffset || u32(view, localOffset) !== 0x04034b50) throw new Error(`${name}: yerel ZIP başlığı bozuk.`);

    const localFlags = u16(view, localOffset + 6), localMethod = u16(view, localOffset + 8);
    const localNameLength = u16(view, localOffset + 26), localExtraLength = u16(view, localOffset + 28);
    if (localFlags !== flags || localMethod !== method) throw new Error(`${name}: yerel ve merkezi ZIP başlıkları uyuşmuyor.`);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (localNameEnd > centralOffset || dataStart < localNameEnd || dataEnd < dataStart || dataEnd > centralOffset) throw new Error(`${name}: dosya verisi ZIP sınırlarının dışında.`);
    if (!sameBytes(rawName, archive.subarray(localNameStart, localNameEnd))) throw new Error(`${name}: yerel ve merkezi ZIP dosya adları uyuşmuyor.`);
    if (method === 0 && compressedSize !== uncompressedSize) throw new Error(`${name}: sıkıştırılmamış ZIP girdisinin boyut alanları uyuşmuyor.`);

    const compressed = archive.subarray(dataStart, dataEnd);
    const bytes = method === 0 ? compressed.slice() : await inflateRaw(compressed, uncompressedSize, name);
    if (bytes.length !== uncompressedSize) throw new Error(`${name}: açılmış boyut beklenen değerle eşleşmiyor.`);
    if (crc32(bytes) !== expectedCrc) throw new Error(`${name}: CRC doğrulaması başarısız; ZIP bozuk olabilir.`);
    const basename = name.replace(/\\/g, '/').split('/').pop();
    results.push(new File([bytes], basename, { type: 'application/octet-stream', lastModified: file.lastModified || Date.now() }));
  }
  if (cursor !== centralEnd) throw new Error('ZIP merkezi dizin boyutu, kayıtlarla eşleşmiyor.');
  if (!results.length) throw new Error('ZIP içinde desteklenen ROM dosyası bulunamadı. Desteklenen uzantılar: .nes, .sfc, .smc, .md, .gen, .bin, .z64, .n64, .v64, .cue, .iso.');
  return results;
}

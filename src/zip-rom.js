const SUPPORTED_ROM_EXTENSIONS = new Set(['nes','sfc','smc','md','gen','bin','z64','n64','v64','cue','iso']);
const MAX_ENTRIES = 1000;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const decoder = new TextDecoder('utf-8');

function u16(v, o) { if (o < 0 || o + 2 > v.length) throw new Error('ZIP arşivi bozuk veya kesik.'); return v.getUint16(o, true); }
function u32(v, o) { if (o < 0 || o + 4 > v.length) throw new Error('ZIP arşivi bozuk veya kesik.'); return v.getUint32(o, true); }
function extOf(name) { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('Bu tarayıcı ZIP içindeki sıkıştırılmış dosyaları açmayı desteklemiyor. Tarayıcıyı güncelle veya ZIP içindeki ROM dosyasını çıkarıp doğrudan yükle.');
  let stream;
  try { stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
  catch { throw new Error('Tarayıcı deflate-raw ZIP sıkıştırmasını desteklemiyor. ZIP içindeki ROM dosyasını çıkarıp doğrudan yükle.'); }
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Extracts supported ROM files from a standard, non-encrypted ZIP in memory. No files are written to disk. */
export async function extractRomFilesFromZip(file) {
  const archive = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const min = Math.max(0, archive.length - 22 - 65535);
  let eocd = -1;
  for (let i = archive.length - 22; i >= min; i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Geçerli ZIP bitiş kaydı bulunamadı. Dosya bozuk veya ZIP64 biçiminde olabilir.');
  const disk = u16(view, eocd + 4), centralDisk = u16(view, eocd + 6);
  const entriesOnDisk = u16(view, eocd + 8), entriesTotal = u16(view, eocd + 10);
  const centralSize = u32(view, eocd + 12), centralOffset = u32(view, eocd + 16);
  const commentLength = u16(view, eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entriesTotal) throw new Error('Çok parçalı ZIP arşivleri desteklenmiyor.');
  if (entriesTotal === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) throw new Error('ZIP64 arşivleri bu sürümde desteklenmiyor. Standart ZIP olarak yeniden sıkıştır.');
  if (entriesTotal > MAX_ENTRIES) throw new Error(`ZIP içinde çok fazla dosya var (sınır ${MAX_ENTRIES}).`);
  if (eocd + 22 + commentLength > archive.length || centralOffset + centralSize > eocd) throw new Error('ZIP dizin bilgileri dosya sınırlarının dışında.');

  const results = [];
  let cursor = centralOffset;
  let totalExpanded = 0;
  for (let i = 0; i < entriesTotal; i++) {
    if (u32(view, cursor) !== 0x02014b50) throw new Error('ZIP dosya dizini bozuk.');
    const flags = u16(view, cursor + 8), method = u16(view, cursor + 10);
    const expectedCrc = u32(view, cursor + 16), compressedSize = u32(view, cursor + 20), uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28), extraLength = u16(view, cursor + 30), entryCommentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
    if (end > archive.length) throw new Error('ZIP dosya adı veya dizin kaydı kesilmiş.');
    const rawName = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = (flags & 0x0800) ? decoder.decode(rawName) : new TextDecoder('windows-1252').decode(rawName);
    cursor = end;
    if (!name || name.endsWith('/') || name.endsWith('\\')) continue;
    const ext = extOf(name);
    if (!SUPPORTED_ROM_EXTENSIONS.has(ext)) continue;
    if (flags & 0x0001) throw new Error(`ZIP şifreli: ${name}. Şifreli arşivler desteklenmiyor.`);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`ZIP içindeki ${name} dosyası 256 MiB sınırını aşıyor.`);
    totalExpanded += uncompressedSize;
    if (totalExpanded > MAX_TOTAL_BYTES) throw new Error('ZIP içindeki açılmış ROM toplamı 512 MiB sınırını aşıyor.');
    if (method !== 0 && method !== 8) throw new Error(`${name}: desteklenmeyen ZIP sıkıştırma yöntemi (${method}).`);
    if (localOffset + 30 > archive.length || u32(view, localOffset) !== 0x04034b50) throw new Error(`${name}: yerel ZIP başlığı bozuk.`);
    const localNameLength = u16(view, localOffset + 26), localExtraLength = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart < 0 || dataEnd > archive.length) throw new Error(`${name}: dosya verisi ZIP sınırlarının dışında.`);
    const compressed = archive.subarray(dataStart, dataEnd);
    const bytes = method === 0 ? compressed.slice() : await inflateRaw(compressed);
    if (bytes.length !== uncompressedSize) throw new Error(`${name}: açılmış boyut beklenen değerle eşleşmiyor.`);
    if (crc32(bytes) !== expectedCrc) throw new Error(`${name}: CRC doğrulaması başarısız; ZIP bozuk olabilir.`);
    const basename = name.replace(/\\/g, '/').split('/').pop();
    results.push(new File([bytes], basename, { type: 'application/octet-stream', lastModified: file.lastModified || Date.now() }));
  }
  if (!results.length) throw new Error('ZIP içinde desteklenen ROM dosyası bulunamadı. Desteklenen uzantılar: .nes, .sfc, .smc, .md, .gen, .bin, .z64, .n64, .v64, .cue, .iso.');
  return results;
}

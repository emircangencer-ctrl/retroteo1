/** Conservative iNES/NES 2.0 ROM container validation. This does not prove game compatibility. */

const SMB3_RELEASES = Object.freeze([
  Object.freeze({ label: 'ABD ilk sürüm', region: 'USA', mapper: 4, prgBytes: 256 * 1024, chrBytes: 128 * 1024, payloadCrc32: 0xa0b0b742 }),
  Object.freeze({ label: 'ABD Rev-A', region: 'USA', mapper: 4, prgBytes: 256 * 1024, chrBytes: 128 * 1024, payloadCrc32: 0x2e6301ed }),
  Object.freeze({ label: 'Japonya', region: 'Japan', mapper: 4, prgBytes: 256 * 1024, chrBytes: 128 * 1024, payloadCrc32: 0xe7ddfee3 }),
  Object.freeze({ label: 'Japonya Rev-A', region: 'Japan', mapper: 4, prgBytes: 256 * 1024, chrBytes: 128 * 1024, payloadCrc32: 0x52e2b5e0 }),
  Object.freeze({ label: 'Avrupa/PAL', region: 'Europe/PAL', mapper: 4, prgBytes: 256 * 1024, chrBytes: 128 * 1024, payloadCrc32: 0x1ed5c801 })
]);
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Identifies a known unmodified SMB3 cartridge payload. A title/header match
 * alone cannot establish that PRG/CHR data is safe to launch.
 */
export function identifySuperMarioBros3Release(inspection, payloadCrc32) {
  if (!inspection?.valid || inspection.format !== 'iNES' ||
      inspection.mapper !== 4 ||
      inspection.prgBytes !== 256 * 1024 ||
      inspection.chrBytes !== 128 * 1024 ||
      !Number.isInteger(payloadCrc32)) return null;
  const release = SMB3_RELEASES.find(entry => entry.payloadCrc32 === (payloadCrc32 >>> 0));
  return release ? { label: release.label, region: release.region, payloadCrc32: release.payloadCrc32 } : null;
}

export function diagnoseSuperMarioBros3Rom(input, name, inspection = inspectNesRom(input)) {
  const originalName = String(name || '');
  const compactName = originalName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compactName.includes('supermariobros3') && !compactName.includes('smb3')) return null;

  if (!inspection?.valid) {
    return { status: 'unsupported-build', message: 'Super Mario Bros. 3 adı verilen dosya NES başlık doğrulamasından geçmedi. Grafik bozulmasını önlemek için başlatma engellendi; temiz ve doğrulanmış bir ROM dosyasını içe aktar.' };
  }

  if (inspection.format !== 'iNES') {
    return {
      status: 'unsupported-build',
      message: 'Super Mario Bros. 3 dosyası NES 2.0 başlığı kullanıyor. Bu sürüm için güvenilir PRG+CHR parmak izi doğrulanamadığından grafik uyumluluğu doğrulanamıyor. Başlatma engellendi; klasik iNES biçimindeki doğrulanmış temiz bir ROM kullan.',
      mapper: inspection.mapper,
      payloadCrc32: null,
      matchesUsaRevisionA: false
    };
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const start = 16 + (inspection.trainerBytes || 0);
  const end = start + inspection.prgBytes + inspection.chrBytes;
  let payloadCrc32 = null;
  if (Number.isInteger(inspection.prgBytes) && Number.isInteger(inspection.chrBytes) &&
      inspection.prgBytes > 0 && inspection.chrBytes >= 0 && bytes.length >= end) {
    payloadCrc32 = crc32(bytes.subarray(start, end));
  }

  const release = identifySuperMarioBros3Release(inspection, payloadCrc32);
  if (release) {
    return {
      status: 'reference-match',
      message: `ROM içeriği bilinen temiz Super Mario Bros. 3 ${release.label} profiliyle eşleşti.`,
      mapper: inspection.mapper,
      payloadCrc32,
      matchesUsaRevisionA: payloadCrc32 === 0x2e6301ed,
      recognizedRelease: release.label
    };
  }

  const details = [];
  const expectedMapper = inspection.mapper === 4;
  const expectedSizes = inspection.prgBytes === 256 * 1024 && inspection.chrBytes === 128 * 1024;
  if (!expectedMapper) details.push(`başlık Mapper ${inspection.mapper} bildiriyor; standart SMB3 kartuşu Mapper 4 (MMC3) kullanır`);
  if (!expectedSizes) details.push('PRG/CHR boyutları bilinen 256 KiB PRG + 128 KiB CHR düzeniyle eşleşmiyor');
  if (payloadCrc32 === null) details.push('PRG+CHR içeriğinin tam parmak izi hesaplanamadı');
  else details.push(`PRG+CHR CRC32 ${payloadCrc32.toString(16).padStart(8, '0').toUpperCase()} bilinen temiz SMB3 referanslarından hiçbiriyle eşleşmiyor (ABD A0B0B742, ABD Rev-A 2E6301ED, Japonya E7DDFEE3, Japonya Rev-A 52E2B5E0, Avrupa/PAL 1ED5C801)`);
  const taggedHack = /\[h\d+[a-z]?\]/i.test(originalName);
  if (taggedHack) details.push('dosya adındaki [h2] benzeri etiket değiştirilmiş/hack ROM olabileceğini gösteriyor');

  details.push('Bu dosyanın bilinen temiz bir SMB3 perakende sürümü olduğu doğrulanamadı; grafik uyumluluğu garanti edilemediği için başlatma engellendi');
  return {
    status: 'unsupported-build',
    message: details.join('. ') + '. Temiz ve doğrulanmış bir Super Mario Bros. 3 ROM dosyasını içe aktar; mevcut dosya değiştirilmedi.',
    mapper: inspection.mapper,
    payloadCrc32,
    matchesUsaRevisionA: false,
    recognizedRelease: null
  };
}

export function isSuperMarioBros3LaunchAllowed(diagnostic) {
  // Non-SMB3 games have no diagnostic and remain unaffected. For SMB3, only
  // independently recognized clean release fingerprints may start.
  return diagnostic == null || diagnostic.status === 'reference-match';
}

export function inspectNesRom(input, { totalSize } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // Callers may pass only the header bytes for preflight. In that case, supply
  // the original file's size separately so valid large ROMs are not rejected.
  const fileSize = Number.isSafeInteger(totalSize) && totalSize >= bytes.length ? totalSize : bytes.length;
  if (bytes.length < 16) return { valid: false, reason: 'Dosya iNES başlığı için çok kısa.' };
  if (bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
    return { valid: false, reason: 'NES dosya imzası bulunamadı (iNES/NES 2.0 bekleniyor).' };
  }
  const flags6 = bytes[6];
  const flags7 = bytes[7];
  const nes2 = (flags7 & 0x0c) === 0x08;
  const trainerBytes = (flags6 & 0x04) ? 512 : 0;
  if (nes2) {
    // NES 2.0 PRG/CHR sizes can use exponent-multiplier encoding. Avoid falsely
    // rejecting valid files with legacy size math; the emulator core must validate fully.
    if (fileSize < 16 + trainerBytes) return { valid: false, reason: 'NES 2.0 başlığı veya trainer verisi eksik.' };
    return { valid: true, format: 'NES 2.0', mapper: ((flags7 & 0xf0) | (flags6 >> 4) | ((bytes[8] & 0x0f) << 8)), submapper: (bytes[8] >> 4) & 0x0f, prgBytes: null, chrBytes: null, trainerBytes, sizeVerified: false, note: 'NES 2.0 başlığı tanındı; ayrıntılı boyut ve mapper uyumluluğu emülatör çekirdeğinde doğrulanmalı.' };
  }
  const prgBytes = bytes[4] * 16384;
  const chrBytes = bytes[5] * 8192;
  if (prgBytes === 0) return { valid: false, reason: 'iNES başlığında PRG-ROM boyutu sıfır.' };
  const expectedMinimum = 16 + trainerBytes + prgBytes + chrBytes;
  if (fileSize < expectedMinimum) return { valid: false, reason: `ROM verisi eksik: başlık ${expectedMinimum} bayt veya daha fazlasını gerektiriyor.` };
  const mapper = (flags7 & 0xf0) | (flags6 >> 4);
  return { valid: true, format: 'iNES', mapper, submapper: 0, prgBytes, chrBytes, trainerBytes, sizeVerified: true, note: 'iNES başlığı ve bildirilen PRG/CHR uzunluğu tutarlı. Bu, oyunun emülatörle uyumlu olduğunu garanti etmez.' };
}

/** Conservative iNES/NES 2.0 ROM container validation. This does not prove game compatibility. */

const SMB3_USA_REV_A = Object.freeze({
  mapper: 4,
  prgBytes: 256 * 1024,
  chrBytes: 128 * 1024,
  // PRG+CHR combined CRC-32 from the documented US Rev-A cartridge profile.
  payloadCrc32: 0x2e6301ed
});
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

export function diagnoseSuperMarioBros3Rom(input, name, inspection = inspectNesRom(input)) {
  const compactName = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compactName.includes('supermariobros3') && !compactName.includes('smb3')) return null;

  if (!inspection?.valid) {
    return { status: 'review', message: 'Super Mario Bros. 3 adını taşıyan dosya NES başlık doğrulamasından geçmedi. Dosya değiştirilmadi; kaynak ROM dosyasını kontrol et.' };
  }

  const warnings = [];
  if (inspection.mapper !== SMB3_USA_REV_A.mapper) {
    warnings.push(`ROM başlığı Mapper ${inspection.mapper} bildiriyor; standart Super Mario Bros. 3 kartuşu Mapper 4 (MMC3) kullanır.`);
  }

  let payloadCrc32 = null;
  let matchesUsaRevisionA = false;
  if (inspection.format === 'iNES' && Number.isInteger(inspection.prgBytes) && Number.isInteger(inspection.chrBytes)) {
    if (inspection.prgBytes !== SMB3_USA_REV_A.prgBytes || inspection.chrBytes !== SMB3_USA_REV_A.chrBytes) {
      warnings.push('PRG/CHR boyutları bilinen ABD Rev-A sürümünün 256 KiB PRG + 128 KiB CHR düzeniyle eşleşmiyor.');
    } else {
      const start = 16 + (inspection.trainerBytes || 0);
      const end = start + inspection.prgBytes + inspection.chrBytes;
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      if (bytes.length < end) {
        warnings.push('PRG/CHR verisi beklenen sınırdan kısa; dosya kesilmiş olabilir.');
      } else {
        payloadCrc32 = crc32(bytes.subarray(start, end));
        matchesUsaRevisionA = payloadCrc32 === SMB3_USA_REV_A.payloadCrc32;
        if (!matchesUsaRevisionA) {
          warnings.push(`PRG+CHR CRC32 ${payloadCrc32.toString(16).padStart(8, '0').toUpperCase()} bilinen ABD Rev-A referansı 2E6301ED ile eşleşmiyor. Başka bir bölge/revizyon veya ROM hack'i olabilir; hasarlı döküm ihtimali de dışlanamaz.`);
        }
      }
    }
  }

  if (warnings.length) {
    return {
      status: 'review',
      message: warnings.join(' '),
      mapper: inspection.mapper,
      payloadCrc32,
      matchesUsaRevisionA: false
    };
  }
  return {
    status: matchesUsaRevisionA ? 'reference-match' : 'mapper-ok',
    message: matchesUsaRevisionA
      ? 'Super Mario Bros. 3 ROM içeriği bilinen ABD Rev-A CRC32 referansıyla eşleşti.'
      : 'Mapper kontrolü geçti. ROM başlığı tek başına bütün grafik uyumluluğunu kanıtlamaz.',
    mapper: inspection.mapper,
    payloadCrc32,
    matchesUsaRevisionA
  };
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

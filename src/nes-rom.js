/** Conservative iNES/NES 2.0 ROM container validation. This does not prove game compatibility. */
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

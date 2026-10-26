// Test helpers: a small ZIP writer and "CRC-matched placeholder" files.
//
// Arcade cores identify ROM files by size and CRC32. To exercise the real recognise → BIOS →
// core-start pipeline without any game data, a placeholder file is all zeros except its last four
// bytes, which are solved so the file has exactly the size and CRC32 a ROM set lists. The files
// contain no copyrighted content; only the published checksum is reproduced.
import { deflateRawSync } from 'node:zlib';

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value++) {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    table[value] = crc >>> 0;
  }
  return table;
})();
const step = (state, byte) => (TABLE[(state ^ byte) & 0xff] ^ (state >>> 8)) >>> 0;

export function crc32(bytes) {
  let state = 0xffffffff;
  for (const byte of bytes) state = step(state, byte);
  return (~state) >>> 0;
}

const zeroStates = new Map();
function stateAfterZeros(length) {
  if (zeroStates.has(length)) return zeroStates.get(length);
  let state = 0xffffffff;
  for (let i = 0; i < length; i++) state = step(state, 0);
  zeroStates.set(length, state);
  return state;
}
function finish(state, word) {
  let s = state;
  for (let k = 0; k < 4; k++) s = step(s, (word >>> (8 * k)) & 0xff);
  return (~s) >>> 0;
}

/** Zero-filled bytes of `size` whose CRC32 is `crcHex` (CRC32 is linear, so 4 bytes suffice). */
export function placeholderWithCrc(size, crcHex) {
  if (size < 4) throw new Error('placeholder needs at least 4 bytes');
  const target = parseInt(crcHex, 16) >>> 0;
  const state = stateAfterZeros(size - 4);
  const base = finish(state, 0);
  const pivots = new Array(32).fill(null);
  for (let i = 0; i < 32; i++) {
    let vector = (finish(state, (1 << i) >>> 0) ^ base) >>> 0;
    let combo = (1 << i) >>> 0;
    for (let bit = 31; bit >= 0; bit--) {
      if (!((vector >>> bit) & 1)) continue;
      if (!pivots[bit]) { pivots[bit] = { vector, combo }; break; }
      vector = (vector ^ pivots[bit].vector) >>> 0;
      combo = (combo ^ pivots[bit].combo) >>> 0;
    }
  }
  let rest = (target ^ base) >>> 0, word = 0;
  for (let bit = 31; bit >= 0; bit--) {
    if (!((rest >>> bit) & 1)) continue;
    if (!pivots[bit]) throw new Error('CRC system not solvable');
    rest = (rest ^ pivots[bit].vector) >>> 0;
    word = (word ^ pivots[bit].combo) >>> 0;
  }
  const bytes = new Uint8Array(size);
  bytes[size - 4] = word & 0xff; bytes[size - 3] = (word >>> 8) & 0xff; bytes[size - 2] = (word >>> 16) & 0xff; bytes[size - 1] = word >>> 24;
  return bytes;
}

/** Writes a standard (non-ZIP64) deflate ZIP from [{ name, data }]. */
export function writeZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(Buffer.from(data), { level: 6 });
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

/** A placeholder set: every listed ROM of `romList` ([name, size, crc, merge]) except `omit`. */
export function placeholderSet(romList, { omit = [] } = {}) {
  return writeZip(romList.filter(([name]) => !omit.includes(name)).map(([name, size, crc]) => ({ name, data: placeholderWithCrc(size, crc) })));
}

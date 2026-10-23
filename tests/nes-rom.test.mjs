import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectNesRom, crc32, diagnoseSuperMarioBros3Rom, identifySuperMarioBros3Release } from '../src/nes-rom.js';
function ines({prg=1,chr=1,trainer=false,mapper=0,extra=0}={}) {
  const n=16+(trainer?512:0)+prg*16384+chr*8192+extra; const b=new Uint8Array(n);
  b.set([0x4e,0x45,0x53,0x1a,prg,chr,((mapper&0x0f)<<4)|(trainer?4:0),(mapper&0xf0)]); return b;
}
test('accepts a consistent legacy iNES file',()=>{const r=inspectNesRom(ines());assert.equal(r.valid,true);assert.equal(r.format,'iNES');assert.equal(r.prgBytes,16384);assert.equal(r.chrBytes,8192);});
test('rejects files shorter than the header',()=>assert.equal(inspectNesRom(new Uint8Array(15)).valid,false));
test('rejects incorrect magic',()=>{const b=ines();b[0]=0;assert.equal(inspectNesRom(b).valid,false);});
test('rejects zero PRG size',()=>assert.equal(inspectNesRom(ines({prg:0})).valid,false));
test('rejects truncated PRG/CHR payload',()=>{const b=ines();assert.equal(inspectNesRom(b.slice(0,100)).valid,false);});
test('validates a 16-byte header using the original file size for large ROMs',()=>{const b=ines({prg:8,chr:1,mapper:4});const header=b.slice(0,16);const r=inspectNesRom(header,{totalSize:b.length});assert.equal(r.valid,true);assert.equal(r.mapper,4);assert.equal(r.prgBytes,8*16384);});
test('still rejects a truncated ROM when original size is supplied',()=>{const b=ines({prg:8,chr:1});const header=b.slice(0,16);assert.equal(inspectNesRom(header,{totalSize:header.length}).valid,false);});
test('accounts for optional trainer',()=>{const b=ines({trainer:true});assert.equal(inspectNesRom(b).valid,true);assert.equal(inspectNesRom(b).trainerBytes,512);});
test('recognizes NES 2.0 conservatively',()=>{const b=ines();b[7]=(b[7]&0xf3)|0x08;const r=inspectNesRom(b);assert.equal(r.valid,true);assert.equal(r.format,'NES 2.0');assert.equal(r.sizeVerified,false);});


test('CRC-32 uses the standard reflected polynomial and canonical test vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('Super Mario Bros. 3 with an incorrect mapper is rejected before launch', () => {
  const bytes = ines({ prg: 1, chr: 1, mapper: 0 });
  const result = diagnoseSuperMarioBros3Rom(bytes, 'Super Mario Bros. 3.nes');
  assert.equal(result.status, 'unsupported-build');
  assert.match(result.message, /Mapper 0/);
  assert.match(result.message, /Mapper 4/);
  assert.equal(result.matchesUsaRevisionA, false);
});

test('Super Mario Bros. 3 refuses an unrecognized PRG/CHR fingerprint rather than launching corrupted graphics', () => {
  const bytes = ines({ prg: 16, chr: 16, mapper: 4 });
  const result = diagnoseSuperMarioBros3Rom(bytes, 'SMB3 (USA).nes');
  assert.equal(result.status, 'unsupported-build');
  assert.match(result.message, /CRC32/);
  assert.match(result.message, /başlatılması engellendi/);
  assert.equal(result.payloadCrc32, crc32(bytes.subarray(16)));
  assert.equal(result.recognizedRelease, null);
});

test('SMB3 cartridge signature registry recognizes known clean region/revision fingerprints', () => {
  const inspection = { valid: true, format: 'iNES', mapper: 4, prgBytes: 256 * 1024, chrBytes: 128 * 1024 };
  assert.equal(identifySuperMarioBros3Release(inspection, 0xa0b0b742)?.label, 'ABD ilk sürüm');
  assert.equal(identifySuperMarioBros3Release(inspection, 0x2e6301ed)?.label, 'ABD Rev-A');
  assert.equal(identifySuperMarioBros3Release(inspection, 0x52e2b5e0)?.label, 'Japonya');
  assert.equal(identifySuperMarioBros3Release(inspection, 0x1ed5c801)?.label, 'Avrupa/PAL');
  assert.equal(identifySuperMarioBros3Release(inspection, 0x7388bebd), null);
  assert.equal(identifySuperMarioBros3Release({ ...inspection, mapper: 0 }, 0x2e6301ed), null);
});

test('SMB3-specific diagnostic does not run for unrelated filenames', () => {
  const bytes = ines({ prg: 1, chr: 1, mapper: 0 });
  assert.equal(diagnoseSuperMarioBros3Rom(bytes, 'Kirby.nes'), null);
});

test('Super Mario Bros. 3 NES 2.0 dumps are blocked when the reference fingerprint cannot be checked', () => {
  const bytes = ines({ prg: 16, chr: 16, mapper: 4 });
  bytes[7] = (bytes[7] & 0xf3) | 0x08;
  const inspection = inspectNesRom(bytes);
  const result = diagnoseSuperMarioBros3Rom(bytes, 'Super Mario Bros. 3.nes', inspection);
  assert.equal(inspection.format, 'NES 2.0');
  assert.equal(result.status, 'unsupported-build');
  assert.match(result.message, /NES 2\.0/);
  assert.match(result.message, /parmak izi doğrulanamadığından/);
  assert.equal(result.matchesUsaRevisionA, false);
});

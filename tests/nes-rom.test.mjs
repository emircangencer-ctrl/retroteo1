import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectNesRom } from '../src/nes-rom.js';
function ines({prg=1,chr=1,trainer=false,mapper=0,extra=0}={}) {
  const n=16+(trainer?512:0)+prg*16384+chr*8192+extra; const b=new Uint8Array(n);
  b.set([0x4e,0x45,0x53,0x1a,prg,chr,((mapper&0x0f)<<4)|(trainer?4:0),(mapper&0xf0)]); return b;
}
test('accepts a consistent legacy iNES file',()=>{const r=inspectNesRom(ines());assert.equal(r.valid,true);assert.equal(r.format,'iNES');assert.equal(r.prgBytes,16384);assert.equal(r.chrBytes,8192);});
test('rejects files shorter than the header',()=>assert.equal(inspectNesRom(new Uint8Array(15)).valid,false));
test('rejects incorrect magic',()=>{const b=ines();b[0]=0;assert.equal(inspectNesRom(b).valid,false);});
test('rejects zero PRG size',()=>assert.equal(inspectNesRom(ines({prg:0})).valid,false));
test('rejects truncated PRG/CHR payload',()=>{const b=ines();assert.equal(inspectNesRom(b.slice(0,100)).valid,false);});
test('validates a header prefix using the original file size for large ROMs',()=>{const b=ines({prg:8,chr:1,mapper:4});const header=b.slice(0,64*1024);const r=inspectNesRom(header,{totalSize:b.length});assert.equal(r.valid,true);assert.equal(r.mapper,4);assert.equal(r.prgBytes,8*16384);});
test('still rejects a truncated ROM when original size is supplied',()=>{const b=ines({prg:8,chr:1});const header=b.slice(0,16);assert.equal(inspectNesRom(header,{totalSize:header.length}).valid,false);});
test('accounts for optional trainer',()=>{const b=ines({trainer:true});assert.equal(inspectNesRom(b).valid,true);assert.equal(inspectNesRom(b).trainerBytes,512);});
test('recognizes NES 2.0 conservatively',()=>{const b=ines();b[7]=(b[7]&0xf3)|0x08;const r=inspectNesRom(b);assert.equal(r.valid,true);assert.equal(r.format,'NES 2.0');assert.equal(r.sizeVerified,false);});

import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractRomFilesFromZip } from '../src/zip-rom.js';

function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function u16(n){const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;}
function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;}
function storedZip(entries){
  const locals=[], centrals=[];let offset=0;
  for(const entry of entries){
    const name=Buffer.from(entry.name,'utf8'), data=Buffer.from(entry.data), crc=crc32(data), method=entry.method||0, packed=method===8?deflateRawSync(data):data;
    const local=Buffer.concat([u32(0x04034b50),u16(20),u16(0x0800),u16(method),u16(0),u16(0),u32(crc),u32(packed.length),u32(data.length),u16(name.length),u16(0),name,packed]);
    locals.push(local);
    centrals.push(Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(method),u16(0),u16(0),u32(crc),u32(packed.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));
    offset+=local.length;
  }
  const central=Buffer.concat(centrals), localData=Buffer.concat(locals);
  const end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(central.length),u32(localData.length),u16(0)]);
  return new File([localData,central,end],'games.zip',{type:'application/zip'});
}
const sampleNes=Buffer.concat([Buffer.from([0x4e,0x45,0x53,0x1a,1,0,0,0,0,0,0,0,0,0,0,0]),Buffer.alloc(16384)]);

test('extracts supported ROMs from a standard ZIP and ignores unrelated files',async()=>{
  const zip=storedZip([{name:'Games/Mario.nes',data:sampleNes},{name:'readme.txt',data:'hello'}]);
  const files=await extractRomFilesFromZip(zip);
  assert.equal(files.length,1);
  assert.equal(files[0].name,'Mario.nes');
  assert.equal(files[0].size,sampleNes.length);
  assert.deepEqual(Buffer.from(await files[0].arrayBuffer()),sampleNes);
});
test('rejects invalid ZIP bytes with a readable error',async()=>{
  await assert.rejects(()=>extractRomFilesFromZip(new File(['not a zip'],'bad.zip')),/ZIP/);
});
test('reports when ZIP has no supported ROM entries',async()=>{
  await assert.rejects(()=>extractRomFilesFromZip(storedZip([{name:'readme.txt',data:'hello'}])),/desteklenen ROM/);
});
test('supports multiple ROMs in one archive',async()=>{
  const files=await extractRomFilesFromZip(storedZip([{name:'one.nes',data:sampleNes},{name:'two.sfc',data:'snes'}]));
  assert.deepEqual(files.map(f=>f.name),['one.nes','two.sfc']);
});

test('rejects a ZIP entry whose payload fails CRC verification',async()=>{
  const zip=storedZip([{name:'bad.nes',data:sampleNes}]);
  const bytes=Buffer.from(await zip.arrayBuffer());
  const nameLen=bytes.readUInt16LE(26), extraLen=bytes.readUInt16LE(28);
  bytes[30+nameLen+extraLen+20]^=0xff;
  await assert.rejects(()=>extractRomFilesFromZip(new File([bytes],'corrupt.zip')),/CRC/);
});

test('extracts a deflate-compressed ZIP entry',async()=>{
  const files=await extractRomFilesFromZip(storedZip([{name:'compressed.nes',data:sampleNes,method:8}]));
  assert.equal(files.length,1);
  assert.deepEqual(Buffer.from(await files[0].arrayBuffer()),sampleNes);
});

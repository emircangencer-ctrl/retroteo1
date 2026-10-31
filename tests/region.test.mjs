import test from 'node:test';
import assert from 'node:assert/strict';
import { megaDriveIsPal, superNintendoIsPal, nesIsPal, fileNameIsPal, isPalGame, regionCoreOptions, NTSC_CORE_OPTIONS } from '../src/lib/region.ts';

const md = region => { const rom = new Uint8Array(0x400); rom.set([...'SEGA GENESIS    '].map(c => c.charCodeAt(0)), 0x100); rom.set([...region].map(c => c.charCodeAt(0)), 0x1F0); return rom; };

test('Mega Drive: a cartridge listing only Europe (or PAL regions) is PAL; America or Japan in the list is not', () => {
  assert.equal(megaDriveIsPal(md('E  ')), true);
  assert.equal(megaDriveIsPal(md('JUE')), false);
  assert.equal(megaDriveIsPal(md('U  ')), false);
  assert.equal(megaDriveIsPal(md('JE ')), false);
  assert.equal(megaDriveIsPal(md('8  ')), true, 'new style: Europe only');
  assert.equal(megaDriveIsPal(md('A  ')), true, 'new style: Europe and Asia PAL');
  assert.equal(megaDriveIsPal(md('4  ')), false, 'new style: America');
  assert.equal(megaDriveIsPal(md('F  ')), false, 'new style: everywhere');
  assert.equal(megaDriveIsPal(md('   ')), null);
  assert.equal(megaDriveIsPal(new Uint8Array(0x400)), null, 'no SEGA header (interleaved .smd)');
});

const snes = (country, { base = 0x7FC0, valid = true, size = 0x8000 * 4 } = {}) => {
  const rom = new Uint8Array(size);
  rom[base + 0x19] = country;
  const checksum = 0x1234;
  const complement = valid ? checksum ^ 0xFFFF : 0x1111;
  rom[base + 0x1C] = complement & 255; rom[base + 0x1D] = complement >> 8; rom[base + 0x1E] = checksum & 255; rom[base + 0x1F] = checksum >> 8;
  return rom;
};

test('Super Nintendo: the header whose checksum and complement match gives the country; 2–12 are PAL', () => {
  assert.equal(superNintendoIsPal(snes(2)), true, 'Europe');
  assert.equal(superNintendoIsPal(snes(9)), true, 'Germany');
  assert.equal(superNintendoIsPal(snes(1)), false, 'USA');
  assert.equal(superNintendoIsPal(snes(0)), false, 'Japan');
  assert.equal(superNintendoIsPal(snes(2, { base: 0xFFC0, size: 0x20000 })), true, 'HiROM');
  assert.equal(superNintendoIsPal(snes(2, { valid: false })), null, 'no valid header');
});

test('NES: NES 2.0 timing, the iNES PAL bit, else the file name', () => {
  const ines = (flags7 = 0, flags9 = 0, byte12 = 0) => { const rom = new Uint8Array(32); rom.set([0x4E, 0x45, 0x53, 0x1A]); rom[7] = flags7; rom[9] = flags9; rom[12] = byte12; return rom; };
  assert.equal(nesIsPal(ines(0x08, 0, 1)), true);
  assert.equal(nesIsPal(ines(0x08, 0, 0), 'Game (Europe).nes'), false, 'NES 2.0 says NTSC');
  assert.equal(nesIsPal(ines(0, 1)), true);
  assert.equal(nesIsPal(ines(), 'Game (Europe).nes'), true);
  assert.equal(nesIsPal(ines(), 'Game (USA, Europe).nes'), false);
  assert.equal(nesIsPal(ines(), 'game.nes'), null);
});

test('file names: European releases are PAL unless America or Japan is part of the release', () => {
  for (const name of ['Ultimate Mortal Kombat 3 (Europe)', 'Sonic (E) [!]', 'Game (PAL)', 'Spiel (Germany)', 'Game (Europe, Australia)']) assert.equal(fileNameIsPal(name), true, name);
  for (const name of ['Game (USA, Europe)', 'Game (World)', 'Game (U) [!]', 'Game (Japan)', 'Game (JUE)']) assert.equal(fileNameIsPal(name), false, name);
  for (const name of ['Game (En,Fr,De)', 'game.md', '']) assert.equal(fileNameIsPal(name), null, name);
  assert.equal(isPalGame('MD', md('JUE'), 'X (Europe)'), false, 'the header wins over the name');
  assert.equal(isPalGame('MD', new Uint8Array(0x400), 'X (Europe)'), true, 'no header: the name');
  assert.equal(isPalGame('ARCADE', new Uint8Array(10), 'X (Europe)'), null);
});

test('60 Hz: each console core gets its own NTSC region option, nothing when not asked', () => {
  assert.deepEqual(regionCoreOptions('picodrive', true), { picodrive_region: 'US' });
  assert.deepEqual(regionCoreOptions('genesis_plus_gx', true), { genesis_plus_gx_region_detect: 'ntsc-u' });
  assert.deepEqual(regionCoreOptions('snes', true), { snes9x_region: 'ntsc' });
  assert.deepEqual(regionCoreOptions('snes9x2005_plus', true), { snes9x_2005_region: 'NTSC' });
  assert.deepEqual(regionCoreOptions('fceumm', true), { fceumm_region: 'NTSC' });
  assert.deepEqual(regionCoreOptions('nestopia', true), { nestopia_favored_system: 'ntsc' });
  assert.deepEqual(regionCoreOptions('picodrive', false), {});
  assert.deepEqual(regionCoreOptions('fbneo', true), {});
  assert.equal(Object.isFrozen(NTSC_CORE_OPTIONS.picodrive), true);
});

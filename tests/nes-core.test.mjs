import test from 'node:test';
import assert from 'node:assert/strict';
import { NES } from '@nesjs/core';
import { normalizeButtonName } from '../src/nes-core-player.js';

function makeMapper4Rom() {
  const prgSize = 8 * 16384;
  const chrSize = 32 * 8192;
  const rom = new Uint8Array(16 + prgSize + chrSize);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 8, 32, 0x40, 0x08], 0);
  // This is a NES 2.0 header. Byte 15 is an expansion-device field.
  rom[15] = 1;
  rom.fill(0xea, 16, 16 + prgSize);
  // Stable JMP loop at $8000 avoids running arbitrary/reset-zero instructions.
  rom.set([0x4c, 0x00, 0x80], 16);
  // NMI, RESET and IRQ vectors in the last 6 bytes of PRG ROM.
  rom.set([0x00, 0x80, 0x00, 0x80, 0x00, 0x80], 16 + prgSize - 6);
  // Different CHR values across 1KB regions make the synthetic image non-empty.
  for (let i = 0; i < chrSize; i++) {
    rom[16 + prgSize + i] = (i >> 10) & 0xff;
  }
  return rom;
}

test('alternate NES core loads mapper 4 NES 2.0 and produces a complete RGBA frame', async () => {
  const rom = makeMapper4Rom();
  let loadedInfo;
  const nes = new NES({ enableCheat: false }, {
    onROMLoaded: info => { loadedInfo = info; }
  });
  let frameCount = 0;
  let frameBytes = 0;
  nes.setRenderer({
    renderFrame(rgba) {
      frameCount++;
      frameBytes = rgba.length;
    }
  });
  nes.setAudioInterface({
    outputSample() {},
    flushFrame() {}
  });
  await nes.loadROM(rom);
  assert.equal(loadedInfo?.mapperNumber, 4);
  assert.equal(loadedInfo?.prgSize, 131072);
  assert.equal(loadedInfo?.chrSize, 262144);
  nes.runFrame();
  assert.equal(frameCount, 1);
  assert.equal(frameBytes, 256 * 240 * 4);
});

test('new core accepts legacy touch-button data attributes', () => {
  assert.equal(normalizeButtonName('BUTTON_UP'), 'UP');
  assert.equal(normalizeButtonName('BUTTON_A'), 'A');
  assert.equal(normalizeButtonName('BUTTON_SELECT'), 'SELECT');
  assert.equal(normalizeButtonName('BUTTON_START'), 'START');
  assert.equal(normalizeButtonName('UNKNOWN'), null);
});

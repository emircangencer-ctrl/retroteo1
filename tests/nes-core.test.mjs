import test from 'node:test';
import assert from 'node:assert/strict';
import { NES } from '@nesjs/core';
import { createFastFrameRenderer, normalizeButtonName } from '../src/nes-core-player.js';

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

test('optimized frame renderer writes correct RGBA pixels into the existing buffer', () => {
  const palette = Array.from({ length: 64 }, (_, i) =>
    (0xff000000 | ((i * 3 & 0xff) << 16) | ((i * 5 & 0xff) << 8) | (i * 7 & 0xff)) >>> 0
  );
  const bitmap = new Uint8Array(256 * 240);
  bitmap[0] = 1;
  bitmap[1] = 2;
  bitmap[2] = 63;
  const imageData = { data: new Uint8ClampedArray(256 * 240 * 4) };
  const nes = { palette, getPalette: () => palette, ppu: { bitmap } };
  let presented = 0;
  const render = createFastFrameRenderer(nes, imageData, frame => {
    assert.equal(frame, imageData);
    presented++;
  });
  render();

  assert.equal(presented, 1);
  assert.deepEqual(Array.from(imageData.data.slice(0, 4)), [
    palette[1] >>> 16 & 0xff,
    palette[1] >>> 8 & 0xff,
    palette[1] & 0xff,
    255
  ]);
  assert.deepEqual(Array.from(imageData.data.slice(4, 8)), [
    palette[2] >>> 16 & 0xff,
    palette[2] >>> 8 & 0xff,
    palette[2] & 0xff,
    255
  ]);
  assert.deepEqual(Array.from(imageData.data.slice(8, 12)), [
    palette[63] >>> 16 & 0xff,
    palette[63] >>> 8 & 0xff,
    palette[63] & 0xff,
    255
  ]);

  render();
  assert.equal(presented, 2);
  assert.equal(imageData.data.length, 256 * 240 * 4);
});

test('optimized frame renderer can skip presentation without skipping emulator frames', () => {
  const palette = Array(64).fill(0xff000000);
  const bitmap = new Uint8Array(256 * 240);
  const imageData = { data: new Uint8ClampedArray(256 * 240 * 4) };
  const nes = { palette, getPalette: () => palette, ppu: { bitmap } };
  let shouldRender = false;
  let presented = 0;
  const render = createFastFrameRenderer(nes, imageData, () => presented++, () => shouldRender);
  render();
  assert.equal(presented, 0);
  shouldRender = true;
  render();
  assert.equal(presented, 1);
});

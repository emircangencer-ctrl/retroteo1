// Self-authored NES test cartridges (no commercial content).
// battery-test.nes — MMC1 with battery-backed WRAM:
//   on every reset it increments $6002 (a boot counter), then increments $6000/$6001 forever,
//   so SRAM changes constantly and a restored save is observable after a soft reset.
const PRG_BANK = 16384;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crcState = (bytes, crc = 0xffffffff) => { for (const b of bytes) crc = (CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0; return crc; };

/**
 * A copy of `rom` whose last 4 bytes are changed so the CRC32 of rom[from..] is `target`: a
 * self-authored cartridge that a checksum list takes for a given game (it holds none of that game).
 */
export function withChecksum(rom, target, from = 16) {
  const out = Uint8Array.from(rom);
  const body = out.subarray(from);
  let t = (Number.parseInt(target, 16) ^ 0xffffffff) >>> 0;
  const ks = [];
  for (let i = 0; i < 4; i++) {
    const k = CRC_TABLE.findIndex(v => v >>> 24 === t >>> 24);
    ks.unshift(k);
    t = ((t ^ CRC_TABLE[k]) << 8) >>> 0;
  }
  let crc = crcState(body.subarray(0, body.length - 4));
  ks.forEach((k, i) => { body[body.length - 4 + i] = (crc ^ k) & 0xff; crc = (CRC_TABLE[k] ^ (crc >>> 8)) >>> 0; });
  return out;
}

function bank(code, vectors) {
  const bytes = new Uint8Array(PRG_BANK).fill(0xea);
  bytes.set(code, 0);
  bytes.set([vectors.nmi & 0xff, vectors.nmi >> 8, vectors.reset & 0xff, vectors.reset >> 8, vectors.irq & 0xff, vectors.irq >> 8], 0x3ffa);
  return bytes;
}

export function batteryTestRom() {
  const code = [
    0x78, 0xd8, 0xa2, 0xff, 0x9a,             // SEI, CLD, LDX #$FF, TXS
    0xa9, 0x80, 0x8d, 0x00, 0x80,             // LDA #$80, STA $8000   (MMC1 reset)
    0xa9, 0x00,                               // LDA #$00
    0x8d, 0x00, 0xe0, 0x8d, 0x00, 0xe0, 0x8d, 0x00, 0xe0, 0x8d, 0x00, 0xe0, 0x8d, 0x00, 0xe0, // 5x STA $E000 → PRG-RAM on
    0xee, 0x02, 0x60,                         // INC $6002   (boot counter)
    0xee, 0x00, 0x60,                         // loop: INC $6000
    0xee, 0x01, 0x60,                         // INC $6001
    0x4c, 0x1e, 0xc0,                         // JMP $C01E
    0x40                                      // RTI ($C027)
  ];
  const vectors = { nmi: 0xc027, reset: 0xc000, irq: 0xc027 };
  const rom = new Uint8Array(16 + 2 * PRG_BANK + 8192);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 2, 1, 0x12, 0x00], 0); // iNES, 32 KiB PRG, 8 KiB CHR, mapper 1, battery
  rom.set(bank(code, vectors), 16);
  rom.set(bank(code, vectors), 16 + PRG_BANK);
  return rom;
}

/** A tiny Mega Drive-shaped file: only the SEGA header matters for import detection. */
export function megaDriveBinStub() {
  const rom = new Uint8Array(128 * 1024);
  const header = 'SEGA GENESIS    ';
  for (let i = 0; i < header.length; i++) rom[0x100 + i] = header.charCodeAt(i);
  return rom;
}

/**
 * A self-authored cartridge with Super Mario Bros. 3's board layout (MMC3, 256 KiB PRG, 128 KiB CHR)
 * but none of its content: its payload fingerprint is unknown, like a ROM hack. The last 8 KiB PRG
 * bank (fixed at $E000) holds an endless loop and the vectors.
 */
export function unverifiedMmc3Rom() {
  const prg = new Uint8Array(256 * 1024).fill(0xea);
  const last = prg.length - 8192;
  prg.set([0x78, 0xd8, 0x4c, 0x02, 0xe0], last);           // SEI, CLD, loop: JMP $E002
  prg.set([0x02, 0xe0, 0x00, 0xe0, 0x02, 0xe0], prg.length - 6); // NMI $E002, RESET $E000, IRQ $E002
  const rom = new Uint8Array(16 + prg.length + 128 * 1024);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 16, 16, 0x40, 0x00], 0); // iNES, mapper 4
  rom.set(prg, 16);
  return rom;
}

/**
 * checkerboard.nes — NROM: turns on background rendering with tile 0 everywhere, and tile 0 is a
 * 1-pixel black/white checkerboard. Every NES pixel alternates colour, so the size of each pixel
 * on screen can be measured exactly (used to check sharp, even pixel scaling).
 */
export function checkerboardRom() {
  const code = [
    0x78, 0xd8, 0xa2, 0xff, 0x9a,                         // SEI, CLD, LDX #$FF, TXS
    0x2c, 0x02, 0x20, 0x10, 0xfb,                         // wait for vblank (BIT $2002 / BPL)
    0x2c, 0x02, 0x20, 0x10, 0xfb,                         // and once more (PPU warm-up)
    0xa9, 0x20, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, // PPUADDR = $2000 (nametable 0)
    0xa2, 0x00, 0xa0, 0x04,                               // X = 0, Y = 4 (4 × 256 bytes)
    0x8d, 0x07, 0x20, 0xe8, 0xd0, 0xfa, 0x88, 0xd0, 0xf7, // clear: write tile 0 and attributes 0
    0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, // PPUADDR = $3F00 (palette)
    0xa9, 0x0f, 0x8d, 0x07, 0x20, 0xa9, 0x30, 0x8d, 0x07, 0x20, // black, white
    0xa9, 0x16, 0x8d, 0x07, 0x20, 0xa9, 0x2a, 0x8d, 0x07, 0x20, // red, green (unused)
    0xa9, 0x00, 0x8d, 0x05, 0x20, 0x8d, 0x05, 0x20,       // scroll 0,0
    0xa9, 0x00, 0x8d, 0x00, 0x20,                         // PPUCTRL: nametable 0, pattern table 0
    0xa9, 0x0a, 0x8d, 0x01, 0x20                          // PPUMASK: show background incl. left column
  ];
  const loop = 0xc000 + code.length;
  code.push(0x4c, loop & 0xff, loop >> 8);                // loop: JMP loop
  const rti = 0xc000 + code.length;
  code.push(0x40);                                        // RTI
  const vectors = { nmi: rti, reset: 0xc000, irq: rti };
  const chr = new Uint8Array(8192);
  for (let row = 0; row < 8; row++) chr[row] = row % 2 ? 0x55 : 0xaa; // tile 0, low plane
  const rom = new Uint8Array(16 + PRG_BANK + 8192);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 1, 0x00, 0x00], 0); // iNES, 16 KiB PRG, 8 KiB CHR, mapper 0
  rom.set(bank(code, vectors), 16);
  rom.set(chr, 16 + PRG_BANK);
  return rom;
}

/**
 * two-players.nes — NROM: reads both controller ports every frame and fills the screen with one
 * colour: red while player 1 holds A, green while player 2 holds A (green wins), black otherwise.
 * Rendering stays off, so the backdrop colour ($3F00) is the whole picture.
 */
export function twoPlayerRom() {
  const code = [
    0x78, 0xd8, 0xa2, 0xff, 0x9a,                         // SEI, CLD, LDX #$FF, TXS
    0xa9, 0x00, 0x8d, 0x00, 0x20, 0x8d, 0x01, 0x20,       // PPUCTRL = PPUMASK = 0 (rendering off)
    0x2c, 0x02, 0x20, 0x10, 0xfb,                         // wait for vblank
    0x2c, 0x02, 0x20, 0x10, 0xfb                          // and once more
  ];
  const loop = 0xc000 + code.length;
  code.push(
    0xa9, 0x01, 0x8d, 0x16, 0x40, 0xa9, 0x00, 0x8d, 0x16, 0x40, // strobe both controllers
    0xa2, 0x08,                                           // X = 8 buttons
    0xad, 0x16, 0x40, 0x4a, 0x26, 0x00,                   // read: LDA $4016, LSR, ROL $00 (player 1)
    0xad, 0x17, 0x40, 0x4a, 0x26, 0x01,                   //       LDA $4017, LSR, ROL $01 (player 2)
    0xca, 0xd0, 0xf1,                                     //       DEX, BNE read  (A ends up in bit 7)
    0x2c, 0x02, 0x20, 0x10, 0xfb,                         // wait for vblank
    0xa0, 0x0f,                                           // Y = black
    0xa5, 0x00, 0x10, 0x02, 0xa0, 0x16,                   // player 1 A → red
    0xa5, 0x01, 0x10, 0x02, 0xa0, 0x2a,                   // player 2 A → green
    0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, // PPUADDR = $3F00
    0x8c, 0x07, 0x20,                                     // STY $2007 (backdrop colour)
    0xa9, 0x00, 0x8d, 0x06, 0x20, 0x8d, 0x06, 0x20,       // PPUADDR = $0000 (the backdrop shows)
    0x4c, loop & 0xff, loop >> 8                          // JMP loop
  );
  const rti = 0xc000 + code.length;
  code.push(0x40);                                        // RTI
  const vectors = { nmi: rti, reset: 0xc000, irq: rti };
  const rom = new Uint8Array(16 + PRG_BANK + 8192);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 1, 0x00, 0x00], 0); // iNES, 16 KiB PRG, 8 KiB CHR, mapper 0
  rom.set(bank(code, vectors), 16);
  return rom;
}

/**
 * colour-cycle.nes — NROM: a frame counter drives the backdrop colour, one of 16 hues ($10–$1F) for
 * 8 frames each, so the picture shows which way time runs (forward, fast forward, rewind).
 */
export function colourCycleRom() {
  const code = [
    0x78, 0xd8, 0xa2, 0xff, 0x9a,                         // SEI, CLD, LDX #$FF, TXS
    0xa9, 0x00, 0x8d, 0x00, 0x20, 0x8d, 0x01, 0x20,       // rendering off
    0x2c, 0x02, 0x20, 0x10, 0xfb,                         // wait for vblank
    0x2c, 0x02, 0x20, 0x10, 0xfb,                         // and once more
    0xa9, 0x00, 0x85, 0x02                                // counter = 0
  ];
  const loop = 0xc000 + code.length;
  code.push(
    0x2c, 0x02, 0x20, 0x10, 0xfb,                         // loop: wait for vblank
    0xe6, 0x02,                                           // INC counter
    0xa5, 0x02, 0x4a, 0x4a, 0x4a, 0x29, 0x0f, 0x09, 0x10, // A = $10 + (counter / 8) % 16
    0x48,                                                 // PHA
    0xa9, 0x3f, 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, // PPUADDR = $3F00
    0x68, 0x8d, 0x07, 0x20,                               // PLA, STA $2007
    0xa9, 0x00, 0x8d, 0x06, 0x20, 0x8d, 0x06, 0x20,       // PPUADDR = $0000
    0x4c, loop & 0xff, loop >> 8                          // JMP loop
  );
  const rti = 0xc000 + code.length;
  code.push(0x40);
  const vectors = { nmi: rti, reset: 0xc000, irq: rti };
  const rom = new Uint8Array(16 + PRG_BANK + 8192);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 1, 0x00, 0x00], 0);
  rom.set(bank(code, vectors), 16);
  return rom;
}

/**
 * A self-authored Mega Drive cartridge with battery RAM ($200001-$203FFF, odd bytes): on every
 * start it adds one to the byte at $200001 (a boot counter) and writes $5A at $200003; then it
 * counts the byte at $200005 up forever, so the battery RAM keeps changing; display on.
 */
export function megaDriveSramRom() {
  const rom = new Uint8Array(128 * 1024);
  const w32 = (o, v) => { rom[o] = v >>> 24; rom[o + 1] = (v >>> 16) & 255; rom[o + 2] = (v >>> 8) & 255; rom[o + 3] = v & 255; };
  w32(0, 0x00FFFE00); w32(4, 0x00000200);
  for (let v = 2; v < 64; v++) w32(v * 4, 0x00000280);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) rom[o + i] = s.charCodeAt(i); };
  text(0x100, 'SEGA GENESIS    '); text(0x150, 'RETROPLAY SRAM TEST'); text(0x180, 'GM 00000000-00');
  w32(0x1A0, 0); w32(0x1A4, rom.length - 1); w32(0x1A8, 0x00FF0000); w32(0x1AC, 0x00FFFFFF);
  rom.set([0x52, 0x41, 0xF8, 0x20], 0x1B0); w32(0x1B4, 0x00200001); w32(0x1B8, 0x00203FFF);
  text(0x1F0, 'JUE');
  const code = [
    0x13FC, 0x0001, 0x00A1, 0x30F1,   // move.b #1,($A130F1)  battery RAM on
    0x1039, 0x0020, 0x0001,           // move.b ($200001),d0
    0x5200,                           // addq.b #1,d0
    0x13C0, 0x0020, 0x0001,           // move.b d0,($200001)
    0x13FC, 0x005A, 0x0020, 0x0003,   // move.b #$5A,($200003)
    0x33FC, 0x8004, 0x00C0, 0x0004, 0x33FC, 0x8174, 0x00C0, 0x0004, 0x33FC, 0x8C81, 0x00C0, 0x0004,
    0x23FC, 0xC000, 0x0000, 0x00C0, 0x0004, 0x33FC, 0x00E0, 0x00C0, 0x0000,
    0x5239, 0x0020, 0x0005,           // loop: addq.b #1,($200005)
    0x60F8];                          // bra loop
  code.forEach((word, i) => { rom[0x200 + i * 2] = word >> 8; rom[0x201 + i * 2] = word & 255; });
  rom[0x280] = 0x4E; rom[0x281] = 0x73; // rte
  let sum = 0; for (let i = 0x200; i < rom.length; i += 2) sum = (sum + ((rom[i] << 8) | rom[i + 1])) & 0xffff;
  rom[0x18E] = sum >> 8; rom[0x18F] = sum & 255;
  return rom;
}

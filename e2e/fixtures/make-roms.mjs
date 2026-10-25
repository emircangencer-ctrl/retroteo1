// Self-authored NES test cartridges (no commercial content).
// battery-test.nes — MMC1 with battery-backed WRAM:
//   on every reset it increments $6002 (a boot counter), then increments $6000/$6001 forever,
//   so SRAM changes constantly and a restored save is observable after a soft reset.
const PRG_BANK = 16384;

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

// European (PAL) cartridges run at 50 frames a second on their console: their game and music are
// about a sixth slower than the American/Japanese (NTSC, 60 Hz) release. The cores pick the region
// from the cartridge; a player can ask for 60 Hz per game, which most PAL releases play correctly.

/** The core option that makes each console core run at 60 Hz (NTSC), from the cores' option lists. */
export const NTSC_CORE_OPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  picodrive: Object.freeze({ picodrive_region: 'US' }),
  genesis_plus_gx: Object.freeze({ genesis_plus_gx_region_detect: 'ntsc-u' }),
  // 'snes' is EmulatorJS's Snes9x (see CONSOLE_CORES).
  snes: Object.freeze({ snes9x_region: 'ntsc' }),
  snes9x: Object.freeze({ snes9x_region: 'ntsc' }),
  snes9x2005_plus: Object.freeze({ snes9x_2005_region: 'NTSC' }),
  fceumm: Object.freeze({ fceumm_region: 'NTSC' }),
  nestopia: Object.freeze({ nestopia_favored_system: 'ntsc' })
});

/** Core options for a game started with a core: 60 Hz when the player asked for it. */
export function regionCoreOptions(coreId: string, sixty: boolean): Record<string, string> {
  return sixty && NTSC_CORE_OPTIONS[coreId] ? { ...NTSC_CORE_OPTIONS[coreId] } : {};
}

const text = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

/**
 * Mega Drive header (raw .md/.bin/.gen: "SEGA" at $100): region at $1F0. Old style letters (J, U,
 * E); new style one hex digit (bit 0 Japan, bit 2 America, bit 3 Europe; bit 1 Asia PAL). PAL when
 * only European/PAL regions are listed: the cores then start the game at 50 Hz.
 */
export function megaDriveIsPal(bytes: Uint8Array): boolean | null {
  if (bytes.length < 0x200 || !text(bytes, 0x100, 4).startsWith('SEGA') && !text(bytes, 0x101, 4).startsWith('SEGA')) return null;
  const region = text(bytes, 0x1F0, 3).replace(/[\s\0]/g, '').toUpperCase();
  if (!region) return null;
  if (/^[0-9A-F]$/.test(region) && !/[JUE]/.test(region)) {
    const bits = parseInt(region, 16);
    return (bits & 0b1010) !== 0 && (bits & 0b0101) === 0;
  }
  if (/[JU]/.test(region)) return false;
  return region.includes('E') ? true : null;
}

/** Super Nintendo internal header: the one whose checksum and complement add up; country 2–12 is PAL. */
export function superNintendoIsPal(bytes: Uint8Array): boolean | null {
  const copier = bytes.length % 1024 === 512 ? 512 : 0;
  for (const base of [0x7FC0, 0xFFC0, 0x40FFC0]) {
    const at = copier + base;
    if (bytes.length < at + 0x20) continue;
    const complement = bytes[at + 0x1C] | (bytes[at + 0x1D] << 8);
    const checksum = bytes[at + 0x1E] | (bytes[at + 0x1F] << 8);
    if ((complement ^ checksum) !== 0xFFFF) continue;
    const country = bytes[at + 0x19];
    return country >= 2 && country <= 12;
  }
  return null;
}

/** NES: NES 2.0 timing (byte 12: 1 PAL), else the iNES PAL bit (byte 9), else the file name. */
export function nesIsPal(bytes: Uint8Array, fileName = ''): boolean | null {
  if (bytes.length >= 16 && text(bytes, 0, 4) === 'NES\x1a') {
    if ((bytes[7] & 0x0C) === 0x08) {
      const timing = bytes[12] & 0x03;
      if (timing === 1) return true;
      if (timing === 0) return false;
    } else if (bytes[9] & 1) return true;
  }
  return fileNameIsPal(fileName);
}

/** No-Intro / GoodTools names: "(Europe)", "(E)", "(PAL)" without an American or Japanese release in it. */
export function fileNameIsPal(name: string): boolean | null {
  const value = String(name || '');
  if (/\((?:[^)]*,\s*)?(?:USA|U|Japan|J|World|JU|UE|JUE|NTSC)(?:\s*,[^)]*)?\)/i.test(value)) return false;
  return /\((?:[^)]*,\s*)?(?:Europe|E|PAL|Germany|France|Spain|Italy|UK|Australia|Sweden|Netherlands)(?:\s*,[^)]*)?\)/i.test(value) ? true : null;
}

/** True when the cartridge is a PAL (50 Hz) release, false when it is not, null when unknown. */
export function isPalGame(platform: string, bytes: Uint8Array | null, fileName = ''): boolean | null {
  if (!bytes) return fileNameIsPal(fileName);
  if (platform === 'MD') return megaDriveIsPal(bytes) ?? fileNameIsPal(fileName);
  if (platform === 'SNES') return superNintendoIsPal(bytes) ?? fileNameIsPal(fileName);
  if (platform === 'NES') return nesIsPal(bytes, fileName);
  return null;
}

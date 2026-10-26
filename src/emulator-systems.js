const makeButton = (label, input, ariaLabel = label) => Object.freeze({ label, input, ariaLabel });

export const EMULATED_SYSTEMS = Object.freeze({
  NES: Object.freeze({
    platform: 'NES',
    label: 'Nintendo Entertainment System',
    shortLabel: 'NES',
    extensions: Object.freeze(['nes']),
    emulatorJsSystemId: 'nes',
    emulatorJsCoreId: 'nestopia',
    supportsLegacyComparison: true,
    actionButtons: Object.freeze([
      makeButton('B', 'BUTTON_B'),
      makeButton('A', 'BUTTON_A')
    ]),
    showSelect: true,
    showStart: true
  }),
  SNES: Object.freeze({
    platform: 'SNES',
    label: 'Super Nintendo',
    shortLabel: 'SNES',
    extensions: Object.freeze(['sfc', 'smc']),
    emulatorJsSystemId: 'snes',
    emulatorJsCoreId: 'snes',
    supportsLegacyComparison: false,
    actionButtons: Object.freeze([
      makeButton('Y', 'BUTTON_Y'),
      makeButton('X', 'BUTTON_X'),
      makeButton('B', 'BUTTON_B'),
      makeButton('A', 'BUTTON_A'),
      makeButton('L', 'BUTTON_L'),
      makeButton('R', 'BUTTON_R')
    ]),
    showSelect: true,
    showStart: true
  }),
  ARCADE: Object.freeze({
    platform: 'ARCADE',
    label: 'Arcade',
    shortLabel: 'Arcade',
    // Arcade sets stay zipped; the zip name is the set name the core looks for.
    extensions: Object.freeze(['zip']),
    emulatorJsSystemId: 'arcade',
    emulatorJsCoreId: 'fbneo',
    supportsLegacyComparison: false,
    // FinalBurn Neo / MAME 2003-Plus RetroPad layout: fire 1-2 on B/A, 3-4 on Y/X, 5-6 on L/R.
    // Six-button games (Street Fighter): punches Y X L on top, kicks B A R below.
    actionButtons: Object.freeze([
      makeButton('Y', 'BUTTON_Y'),
      makeButton('X', 'BUTTON_X'),
      makeButton('L', 'BUTTON_L'),
      makeButton('B', 'BUTTON_B'),
      makeButton('A', 'BUTTON_A'),
      makeButton('R', 'BUTTON_R')
    ]),
    // Neo Geo A/B/C/D are RetroPad B/A/Y/X in FinalBurn Neo.
    neoGeoButtons: Object.freeze([
      makeButton('C', 'BUTTON_Y'),
      makeButton('D', 'BUTTON_X'),
      makeButton('A', 'BUTTON_B'),
      makeButton('B', 'BUTTON_A')
    ]),
    selectLabel: 'JETON',
    showSelect: true,
    showStart: true
  }),
  MD: Object.freeze({
    platform: 'MD',
    label: 'Sega Mega Drive',
    shortLabel: 'Mega Drive',
    // `.bin` reaches the player only after import verified the SEGA header (see rom-detect.js).
    extensions: Object.freeze(['md', 'gen', 'bin']),
    emulatorJsSystemId: 'segaMD',
    emulatorJsCoreId: 'segaMD',
    supportsLegacyComparison: false,
    actionButtons: Object.freeze([
      makeButton('Y', 'BUTTON_X'),
      makeButton('X', 'BUTTON_L'),
      makeButton('Z', 'BUTTON_R'),
      makeButton('B', 'BUTTON_B'),
      makeButton('C', 'BUTTON_A'),
      makeButton('A', 'BUTTON_Y')
    ]),
    showSelect: false,
    showStart: true
  })
});

export function getEmulatedSystem(platform) {
  if (typeof platform !== 'string' || !Object.prototype.hasOwnProperty.call(EMULATED_SYSTEMS, platform)) return null;
  return EMULATED_SYSTEMS[platform];
}

export function isPlayablePlatform(platform) {
  return Boolean(getEmulatedSystem(platform));
}

export function supportsRomExtension(platform, extension) {
  const system = getEmulatedSystem(platform);
  return Boolean(system && system.extensions.includes(String(extension || '').toLowerCase()));
}

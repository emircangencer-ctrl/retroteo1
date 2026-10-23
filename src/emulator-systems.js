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
  MD: Object.freeze({
    platform: 'MD',
    label: 'Sega Mega Drive',
    shortLabel: 'Mega Drive',
    extensions: Object.freeze(['md', 'gen']),
    emulatorJsSystemId: 'segaMD',
    emulatorJsCoreId: 'segaMD',
    supportsLegacyComparison: false,
    actionButtons: Object.freeze([
      makeButton('Y', 'BUTTON_X'),
      makeButton('X', 'BUTTON_L'),
      makeButton('Z', 'BUTTON_R'),
      makeButton('B', 'BUTTON_B'),
      makeButton('C', 'BUTTON_Y'),
      makeButton('A', 'BUTTON_A')
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

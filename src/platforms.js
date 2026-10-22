export const PLATFORM = Object.freeze({
  NES: { label: 'Nintendo Entertainment System', short: 'NES', logo: 'NES', color: '#284e78', glow: '#3b9bca', ext: ['nes'] },
  SNES: { label: 'Super Nintendo', short: 'SNES', logo: 'SNES', color: '#44336c', glow: '#9b78ff', ext: ['sfc','smc'] },
  MD: { label: 'Sega Mega Drive', short: 'Mega Drive', logo: 'MD', color: '#285b52', glow: '#40dcaa', ext: ['md','gen'] },
  N64: { label: 'Nintendo 64', short: 'N64', logo: 'N64', color: '#6b4934', glow: '#e6ad5b', ext: ['z64','n64','v64'] },
  CPS1: { label: 'Capcom Play System 1', short: 'CPS1', logo: 'CPS1', color: '#7b3a4b', glow: '#ff8c9c', ext: [] },
  CPS2: { label: 'Capcom Play System 2', short: 'CPS2', logo: 'CPS2', color: '#3b477d', glow: '#8bb4ff', ext: [] },
  NEOGEO: { label: 'Neo Geo', short: 'Neo Geo', logo: 'NG', color: '#6a512d', glow: '#f2c56f', ext: [] }
});

const UNKNOWN_PLATFORM = Object.freeze({
  label: 'Bilinmeyen sistem',
  logo: '?',
  color: '#344158',
  glow: '#8b9ab0',
  ext: []
});

/** Resolve only own platform keys so names such as "__proto__" stay ordinary strings. */
export function platformInfo(key) {
  if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(PLATFORM, key)) return PLATFORM[key];
  return {
    ...UNKNOWN_PLATFORM,
    short: typeof key === 'string' && key.length ? key : 'Bilinmiyor'
  };
}

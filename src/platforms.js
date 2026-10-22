export const PLATFORM = Object.freeze({
  NES: Object.freeze({ label: 'Nintendo Entertainment System', short: 'NES', logo: 'NES', color: '#284e78', glow: '#3b9bca', ext: Object.freeze(['nes']) }),
  SNES: Object.freeze({ label: 'Super Nintendo', short: 'SNES', logo: 'SNES', color: '#44336c', glow: '#9b78ff', ext: Object.freeze(['sfc','smc']) }),
  MD: Object.freeze({ label: 'Sega Mega Drive', short: 'Mega Drive', logo: 'MD', color: '#285b52', glow: '#40dcaa', ext: Object.freeze(['md','gen']) }),
  N64: Object.freeze({ label: 'Nintendo 64', short: 'N64', logo: 'N64', color: '#6b4934', glow: '#e6ad5b', ext: Object.freeze(['z64','n64','v64']) }),
  CPS1: Object.freeze({ label: 'Capcom Play System 1', short: 'CPS1', logo: 'CPS1', color: '#7b3a4b', glow: '#ff8c9c', ext: Object.freeze([]) }),
  CPS2: Object.freeze({ label: 'Capcom Play System 2', short: 'CPS2', logo: 'CPS2', color: '#3b477d', glow: '#8bb4ff', ext: Object.freeze([]) }),
  NEOGEO: Object.freeze({ label: 'Neo Geo', short: 'Neo Geo', logo: 'NG', color: '#6a512d', glow: '#f2c56f', ext: Object.freeze([]) })
});

const UNKNOWN_PLATFORM = Object.freeze({
  label: 'Bilinmeyen sistem',
  logo: '?',
  color: '#344158',
  glow: '#8b9ab0',
  ext: Object.freeze([])
});

/** Resolve only own platform keys and keep untrusted legacy labels bounded. */
export function platformInfo(key) {
  if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(PLATFORM, key)) return PLATFORM[key];
  const short = typeof key === 'string'
    ? key.slice(0, 32).replace(/[\u0000-\u001f\u007f]/g, '')
    : '';
  return { ...UNKNOWN_PLATFORM, short: short || 'Bilinmiyor' };
}

// How each system looks in the interface (stripe colour, badge, labels). The emulator side of a
// system lives in emulator-systems.js; platform keys come from platforms.js.
import { isPlayablePlatform } from '../emulator-systems.js';
import type { Game } from './types.ts';

export interface SystemLook {
  key: string;
  /** Chip and badge label ("Mega Drive"). */
  label: string;
  /** Upper-case label on the card stripe ("MEGA DRIVE"). */
  stripeLabel: string;
  stripe: string;
  badgeBg: string;
  badgeFg: string;
  playable: boolean;
}

const LOOKS: Record<string, Omit<SystemLook, 'key' | 'playable'>> = {
  NES: { label: 'NES', stripeLabel: 'NES', stripe: '#E5484D', badgeBg: '#2A1517', badgeFg: '#FF9A9C' },
  SNES: { label: 'SNES', stripeLabel: 'SNES', stripe: '#9B8AFB', badgeBg: '#1D1934', badgeFg: '#C7BDFF' },
  MD: { label: 'Mega Drive', stripeLabel: 'MEGA DRIVE', stripe: '#2BC4B0', badgeBg: '#0E2623', badgeFg: '#8BE8DA' },
  ARCADE: { label: 'Arcade', stripeLabel: 'ARCADE', stripe: '#F472B6', badgeBg: '#2B1424', badgeFg: '#FFA9D3' },
  N64: { label: 'N64', stripeLabel: 'N64', stripe: '#8C94A1', badgeBg: '#1C1F25', badgeFg: '#C2C7D0' }
};
const UNKNOWN = { label: 'Bilinmiyor', stripeLabel: 'BİLİNMİYOR', stripe: '#5D6470', badgeBg: '#1C1F25', badgeFg: '#C2C7D0' };

/** Systems shown as filters, in this order (only those with games appear). */
export const SYSTEM_ORDER = Object.freeze(['NES', 'SNES', 'MD', 'ARCADE', 'N64']);

export function systemLook(key: string | null | undefined): SystemLook {
  const k = typeof key === 'string' ? key : '';
  const look = Object.prototype.hasOwnProperty.call(LOOKS, k) ? LOOKS[k] : UNKNOWN;
  return { key: k || 'UNKNOWN', ...look, playable: isPlayablePlatform(k) };
}

/** Neo Geo games are arcade sets that need neogeo.zip; their card says so. */
export function gameLook(game: Game): SystemLook {
  const look = systemLook(game.platform);
  if (game.platform === 'ARCADE' && game.arcade?.bios === 'neogeo') return { ...look, stripeLabel: 'NEO GEO', label: 'Neo Geo' };
  return look;
}

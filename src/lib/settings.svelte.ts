// User preferences, kept in localStorage. Touch-pad settings keep their earlier key and format
// (retroplay-touch-settings); the display choice reads the earlier single mode when no new choice
// has been stored yet.
import { loadDisplay, storeDisplay, normalizeDisplay } from '../display-modes.js';
import { normalizeTouchSettings, TOUCH_SETTINGS_KEY } from '../touch-layout.js';
import { normalizeSort, type SortKey } from './library-view.ts';

export const ACCENTS = Object.freeze([
  { value: '#FF5B2E', label: 'Turuncu' },
  { value: '#FFB020', label: 'Sarı' },
  { value: '#3DD9C1', label: 'Turkuaz' },
  { value: '#8B7CFF', label: 'Mor' }
]);
export const APP_SETTINGS_KEY = 'retroplay-app-settings';

export interface AppPrefs {
  accent: string;
  /** Keep where the player left off when leaving a game, and continue from there next time. */
  autoResume: boolean;
  /** Box art from the RetroArch cover archive, fetched once and kept on the device. */
  covers: boolean;
  layout: 'grid' | 'list';
  sort: SortKey;
  volume: number;
}

export type TouchSettings = ReturnType<typeof normalizeTouchSettings>;
export type DisplayChoice = ReturnType<typeof normalizeDisplay>;

export function normalizePrefs(value: unknown): AppPrefs {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const volume = Number(raw.volume);
  return {
    accent: ACCENTS.some(a => a.value === raw.accent) ? (raw.accent as string) : ACCENTS[0].value,
    autoResume: typeof raw.autoResume === 'boolean' ? raw.autoResume : true,
    covers: typeof raw.covers === 'boolean' ? raw.covers : true,
    layout: raw.layout === 'list' ? 'list' : 'grid',
    sort: normalizeSort(raw.sort),
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.7
  };
}

function read(key: string): unknown {
  try { const text = localStorage.getItem(key); return text ? JSON.parse(text) : {}; } catch { return {}; }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

class Settings {
  prefs = $state<AppPrefs>(normalizePrefs(read(APP_SETTINGS_KEY)));
  display = $state<DisplayChoice>(loadDisplay());
  touch = $state<TouchSettings>(normalizeTouchSettings(read(TOUCH_SETTINGS_KEY)));

  setPrefs(patch: Partial<AppPrefs>) {
    this.prefs = normalizePrefs({ ...this.prefs, ...patch });
    store(APP_SETTINGS_KEY, this.prefs);
  }

  setDisplay(patch: Partial<DisplayChoice>) {
    this.display = storeDisplay({ ...this.display, ...patch });
  }

  setTouch(patch: Partial<TouchSettings> | TouchSettings) {
    this.touch = normalizeTouchSettings({ ...this.touch, ...patch });
    store(TOUCH_SETTINGS_KEY, this.touch);
  }

  resetTouch() {
    this.touch = normalizeTouchSettings({});
    store(TOUCH_SETTINGS_KEY, this.touch);
  }
}

export const settings = new Settings();

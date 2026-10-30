export const DISPLAY_MODE_STORAGE_KEY: string;
export const DEFAULT_DISPLAY_MODE: string;
export const DISPLAY_MODES: Readonly<Record<'sharp' | 'pixel' | 'crt' | 'integer', { label: string; shader: string; integer: boolean }>>;
export function normalizeDisplayMode(value: unknown): 'sharp' | 'pixel' | 'crt' | 'integer';
export function nextDisplayMode(value: unknown): string;
export function displayStartOptions(value: unknown): { shader: string; retroarchConfig: Record<string, string> };
export const RETROPLAY_SHADERS: Readonly<Record<string, unknown>>;
export type DisplayScale = 'sharp' | 'pixel' | 'integer';
export type DisplayFilter = 'none' | 'crt' | 'lcd';
export interface Display { scale: DisplayScale; filter: DisplayFilter }
export const DISPLAY_SETTINGS_KEY: string;
export const DISPLAY_SCALES: Readonly<Record<DisplayScale, { label: string; hint: string; shader: string; integer: boolean }>>;
export const DISPLAY_FILTERS: Readonly<Record<DisplayFilter, { label: string; hint: string; shader: string | null }>>;
export function normalizeDisplay(value: unknown): Display;
export function displayLabel(value: unknown): string;
export function displayShader(value: unknown): string;
export function displayStart(value: unknown): { shader: string; retroarchConfig: Record<string, string> };
export function loadDisplay(storage?: Storage): Display;
export function storeDisplay(value: unknown, storage?: Storage): Display;

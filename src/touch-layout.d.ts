export const DIRECTION_BUTTONS: readonly string[];
export const DIAGONAL_WIDTH: Readonly<Record<'az' | 'normal' | 'cok', number>>;
export const TOUCH_SETTINGS_KEY: string;
export type LayoutGroup = 'dpad' | 'face' | 'system';
export type LayoutAdjust = Record<LayoutGroup, { x: number; y: number; s: number }>;
export interface TouchSettings { scale: number; opacity: number; haptics: boolean; dpadMode: '8' | '4'; diagonal: 'az' | 'normal' | 'cok'; floating: boolean; hideWithGamepad: boolean; arcadeButtons: 'game' | 'all'; layouts: Record<string, LayoutAdjust> }
export const LAYOUT_GROUPS: readonly LayoutGroup[];
export const LAYOUT_SCALE: Readonly<{ min: number; max: number }>;
export function layoutKey(padId: string, orientation: string): string;
export function normalizeAdjust(value: unknown): LayoutAdjust;
export const DEFAULT_TOUCH_SETTINGS: Readonly<TouchSettings>;
export function normalizeTouchSettings(value?: unknown): TouchSettings;
export function dpadSector(dx: number, dy: number, radius: number, options?: Record<string, unknown>): number;
export function sectorButtons(sector: number): readonly string[];
export function faceButtonsAt(x: number, y: number, buttons: unknown[], options?: Record<string, unknown>): string[];
export interface PadSpec { id: string; unit: number; face: any[]; shoulders: any[]; system: any[]; fourWay?: boolean; [key: string]: any }
export const PAD_SPECS: Readonly<Record<string, PadSpec>>;
export function padSpecFor(platform: string, arcadeLayout?: string, arcade?: { core?: string; buttons?: number; ways?: number } | null, settings?: TouchSettings): PadSpec;
export interface TouchLayout {
  orientation: 'portrait' | 'landscape';
  overlay: boolean;
  screen: { x: number; y: number; w: number; h: number };
  chrome: { bar: { h: number; padTop: number } };
  padHidden: boolean;
  fourWay: boolean;
  [key: string]: any;
}
export function adjustLayout(layout: TouchLayout, adjust: unknown): TouchLayout & { adjust: LayoutAdjust };
export function layoutGroups(layout: TouchLayout): Array<{ group: LayoutGroup; box: { x: number; y: number; w: number; h: number }; parts: Array<{ x: number; y: number; w: number; h: number }> }>;
export function computeTouchLayout(options: { width: number; height: number; safe?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>; aspect?: number; spec?: PadSpec; settings?: TouchSettings; padHidden?: boolean }): TouchLayout;

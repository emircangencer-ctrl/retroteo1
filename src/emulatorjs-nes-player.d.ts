export const EMULATORJS_VERSION: string;
export function emulatorJsDataPath(base?: string): string;
export const EMULATORJS_INPUT_INDEX: Readonly<Record<string, number>>;
export interface KeyboardPlayerKeys { move: readonly string[]; bottom: readonly string[]; top: readonly string[]; start: readonly string[]; select: readonly string[] }
export const KEYBOARD_PLAYERS: readonly KeyboardPlayerKeys[];
export const BUTTON_BLOCKS: Readonly<Record<string, { bottom: readonly string[]; top: readonly string[] }>>;
export function keyboardMap(systemId?: string): Readonly<Record<string, readonly [number, string]>>;
export const MIN_SYSTEM_PRESS_MS: number;
export const EMULATORJS_PLAYERS: number;
export function buildEmulatorDocument(gameUrl: string, gameName: string, systemId?: string, gameId?: number, coreId?: string, options?: Record<string, unknown>): string;
export interface EmulatorJsPlayerOptions {
  onError?: (error: Error) => void;
  onWarning?: (message: string) => void;
  onHotkey?: (key: string, pressed?: boolean) => void;
  gameId?: number;
  systemId?: string;
  systemLabel?: string;
  coreId?: string;
  extraFiles?: Array<{ name: string; url: string }>;
  retroarchConfig?: Record<string, string>;
  coreOptions?: Record<string, string>;
  shader?: string;
  /** At most this many picture lines (0: no limit; software WebGL lowers it to 480). */
  canvasCap?: number;
}
export class EmulatorJsPlayer {
  constructor(container: HTMLElement | null, options?: EmulatorJsPlayerOptions);
  engineName: string;
  romInfo: any;
  started: boolean;
  destroyed: boolean;
  loadROM(bytes: Uint8Array | ArrayBuffer | Blob | null | undefined, gameName?: string): Promise<boolean>;
  setImmersive(active: boolean): void;
  fitInParent(): void;
  pause(): void;
  resume(): void;
  readSaveData(options?: { flush?: boolean }): Uint8Array | null;
  writeSaveData(bytes: Uint8Array | ArrayBuffer | null): boolean;
  contentLoaded(): boolean | null;
  supportsStates(): boolean;
  saveState(): Uint8Array | null;
  loadState(bytes: Uint8Array | ArrayBuffer): boolean;
  measurePace(options?: { ms?: number }): Promise<number | null>;
  benchmark(options?: { seconds?: number; nominalFps?: number }): Promise<{ fps: number; headroom: number; frames: number; ms: number } | null>;
  setShader(name: string): boolean;
  setVolume(value: number): boolean;
  resumeAudio(): void;
  renderInfo(): { software: string; cap: number; width: number; height: number };
  screenshot(options?: { timeout?: number }): Promise<Blob | null>;
  restartGame(): boolean;
  fastForward: boolean;
  rewinding: boolean;
  setFastForward(active: boolean): boolean;
  supportsRewind(): boolean;
  setRewind(active: boolean): boolean;
  pressButton(name: string, source?: string, player?: number): void;
  releaseButton(name: string, source?: string, player?: number): void;
  tapButton(name: string, ms?: number, player?: number): boolean;
  releaseAllButtons(): void;
  destroy(): void;
}
export class EmulatorJsNesPlayer extends EmulatorJsPlayer {}

// RetroPlay TV: the Android TV / Google TV app hosts this web app in a WebView and exposes
// window.RetroPlayTV (see tv/android). This module reads it without depending on Svelte, so the
// controller bridge can be unit-tested.

export interface TvBridge {
  info(): string;
  gamepadVersion(): number;
  gamepads(): string;
  inbox(): string;
  inboxDelete(id: string): boolean;
  startUpload(): string;
  stopUpload(): void;
  setKeepScreenOn(on: boolean): void;
  exit(): void;
  /** The TV's display mode (app 1.2+): JSON, see TvDisplay. */
  display?(): string;
  /** Opens the live site ('live') or a pull request's deploy preview (its number) (app 1.2+). */
  openSite?(which: string): boolean;
}

export interface TvInfo { app: string; versionName: string; versionCode: number; sdk: number; model: string; device: string; address: string | null; filePicker: boolean; preview?: number; sites?: boolean }
/** mode "3840x2160@60.00"; requested: the mode the app asked for so games run at 60 Hz ('' if none). */
export interface TvDisplay { mode: string; refresh: number; width: number; height: number; requested: string; modes: string[] }

/** The emulator advances one frame per screen refresh: how much slower than 60 Hz games play (0–1). */
export function refreshSlowdown(refresh: number): number {
  if (!Number.isFinite(refresh) || refresh <= 0 || Math.abs(refresh - 60) <= 0.5) return 0;
  return refresh < 60 ? 1 - refresh / 60 : 0;
}

/** A pull request number typed on the TV (1–999999), or '' if it is not one. */
export function previewNumber(text: string): string {
  const value = String(text ?? '').trim();
  return /^[1-9]\d{0,5}$/.test(value) ? value : '';
}
export interface InboxFile { id: string; name: string; size: number; time: number }
export interface UploadInfo { url: string; address: string; port: number; code: string }

/** Where the page reads a file sent to the TV (answered by the TV app, never by the network). */
export const INBOX_URL = '/__tv/inbox/';
/** The APK, published by the TV workflow (tv/README.md). */
export const TV_APK_URL = 'https://github.com/emircangencer-ctrl/retroteo1/releases/download/tv-latest/RetroPlayTV.apk';

export function readBridge(scope: unknown = globalThis): TvBridge | null {
  const bridge = (scope as { RetroPlayTV?: unknown } | undefined)?.RetroPlayTV as Partial<TvBridge> | undefined;
  return bridge && typeof bridge.info === 'function' && typeof bridge.gamepads === 'function' ? bridge as TvBridge : null;
}

/** The TV app, or ?tv=1 to see the TV layout in a browser. */
export function detectTv(scope: { location?: { search?: string }; navigator?: { userAgent?: string } } & Record<string, unknown> = globalThis as never): boolean {
  if (readBridge(scope)) return true;
  if (/(?:^|[?&])tv=1(?:&|$)/.test(scope.location?.search || '')) return true;
  return /\bRetroPlayTV\//.test(scope.navigator?.userAgent || '');
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  try { return text ? JSON.parse(text) as T : fallback; } catch { return fallback; }
}

// ---- controllers ------------------------------------------------------------------------------
interface BridgePad { index: number; id: string; timestamp: number; buttons: Array<[number, number]>; axes: number[] }

/** A plain object shaped like the browser's Gamepad (what RetroPlay's readers use). */
export interface BridgeGamepad {
  id: string; index: number; connected: boolean; mapping: 'standard'; timestamp: number;
  buttons: Array<{ pressed: boolean; touched: boolean; value: number }>;
  axes: number[];
}

/**
 * navigator.getGamepads() for the TV app: controllers are read natively (the WebView would also
 * see them as arrow keys and Back) and polled here. The JSON is parsed only when it changed.
 */
export function createGamepadSource(bridge: Pick<TvBridge, 'gamepadVersion' | 'gamepads'>) {
  let version = -1;
  let list: Array<BridgeGamepad | null> = [null, null, null, null];
  return function getGamepads(): Array<BridgeGamepad | null> {
    let current = -1;
    try { current = bridge.gamepadVersion(); } catch { return list; }
    if (current === version) return list;
    version = current;
    const data = parseJson<{ pads?: BridgePad[] }>(bridge.gamepads(), {});
    const next: Array<BridgeGamepad | null> = [null, null, null, null];
    for (const pad of data.pads || []) {
      if (!Number.isInteger(pad.index) || pad.index < 0 || pad.index > 3) continue;
      next[pad.index] = {
        id: String(pad.id || 'Kontrolcü'), index: pad.index, connected: true, mapping: 'standard', timestamp: Number(pad.timestamp) || 0,
        buttons: (pad.buttons || []).map(([pressed, value]) => ({ pressed: Boolean(pressed), touched: Boolean(pressed), value: Number(value) || 0 })),
        axes: (pad.axes || []).map(value => Number(value) || 0)
      };
    }
    list = next;
    return list;
  };
}

/** The ids of connected controllers, to notice connections and disconnections. */
export function padKeys(pads: Array<BridgeGamepad | null>): string {
  return pads.filter(Boolean).map(pad => `${pad!.index}:${pad!.id}`).join('|');
}

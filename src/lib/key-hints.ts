// Which keyboard keys play the game now: derived from the console's (or cabinet's) pad, so the
// hints name only the buttons this game has, with that pad's own labels.
import { KEYBOARD_MAP } from '../emulatorjs-nes-player.js';

export interface PadButton { input: string; label: string }
export interface PadSpecLike { face: readonly PadButton[]; shoulders: readonly PadButton[]; system: readonly PadButton[] }
export interface KeyHint { codes: string[]; label: string; kind: 'move' | 'button' | 'system' | 'menu' }

/** The key shown for Select and Start: MAME's 5 and 1 on arcade games, Right Shift and Enter elsewhere. */
export const PRIMARY_SYSTEM_KEY = Object.freeze({
  arcade: Object.freeze({ BUTTON_SELECT: 'Digit5', BUTTON_START: 'Digit1' }),
  console: Object.freeze({ BUTTON_SELECT: 'ShiftRight', BUTTON_START: 'Enter' })
});
/** FinalBurn Neo numbers arcade buttons by position: 1 = RetroPad B, 2 = A, 3 = Y, 4 = X, 5 = L, 6 = R. */
const ARCADE_NUMBER: Record<string, string> = { BUTTON_B: '1', BUTTON_A: '2', BUTTON_Y: '3', BUTTON_X: '4', BUTTON_L: '5', BUTTON_R: '6' };
const BUTTON_KEY_ORDER = ['KeyZ', 'KeyX', 'KeyA', 'KeyS', 'KeyQ', 'KeyW'];

/** Every key that presses a RetroPad button, in the map's order. */
export function keysFor(input: string): string[] {
  return Object.entries(KEYBOARD_MAP).filter(([, button]) => button === input).map(([code]) => code);
}

export function systemLabel(input: string, arcade: boolean): string {
  if (input === 'BUTTON_SELECT') return arcade ? 'Jeton' : 'Select';
  return arcade ? 'Başla' : 'Start';
}

export function keyHints(spec: PadSpecLike, { arcade = false }: { arcade?: boolean } = {}): KeyHint[] {
  const hints: KeyHint[] = [{ codes: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], label: arcade ? 'joystick' : 'yön', kind: 'move' }];
  const buttons = [...spec.face, ...spec.shoulders]
    .map(b => ({ code: keysFor(b.input)[0], label: b.label || ARCADE_NUMBER[b.input] || '' }))
    .filter(b => b.code)
    .sort((a, b) => BUTTON_KEY_ORDER.indexOf(a.code) - BUTTON_KEY_ORDER.indexOf(b.code));
  for (const b of buttons) hints.push({ codes: [b.code], label: b.label, kind: 'button' });
  const primary = arcade ? PRIMARY_SYSTEM_KEY.arcade : PRIMARY_SYSTEM_KEY.console;
  for (const s of spec.system) {
    const code = primary[s.input as keyof typeof primary];
    if (code) hints.push({ codes: [code], label: systemLabel(s.input, arcade), kind: 'system' });
  }
  hints.push({ codes: ['Escape'], label: 'menü', kind: 'menu' });
  return hints;
}

const FIXED: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Esc',
  ShiftRight: 'Sağ Shift', ControlRight: 'Sağ Ctrl'
};

/** The printed label for a key code; `layout` maps codes to the layout's characters. */
export function keyCap(code: string, layout: ReadonlyMap<string, string> | null = null): string {
  if (FIXED[code]) return FIXED[code];
  const printed = layout?.get(code);
  if (printed && printed.trim()) return printed.toLocaleUpperCase('tr-TR');
  const match = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
  return match ? match[1] : code;
}

// Which keyboard keys play the game now, for each player: derived from the console's (or
// cabinet's) pad, so the hints name only the buttons this game has, with that pad's own labels.
import { keyboardMap, KEYBOARD_PLAYERS } from '../emulatorjs-nes-player.js';

export interface PadButton { input: string; label: string }
export interface PadSpecLike { face: readonly PadButton[]; shoulders: readonly PadButton[]; system: readonly PadButton[] }
export interface KeyHint { codes: string[]; label: string; kind: 'move' | 'button' | 'system' | 'menu' }

/**
 * The key shown for Select and Start: player 1 MAME's 5 and 1 on arcade games, Right Shift and
 * Enter elsewhere; player 2 MAME's 6 and 2.
 */
export const PRIMARY_SYSTEM_KEY = Object.freeze({
  arcade: Object.freeze({ BUTTON_SELECT: 'Digit5', BUTTON_START: 'Digit1' }),
  console: Object.freeze({ BUTTON_SELECT: 'ShiftRight', BUTTON_START: 'Enter' }),
  player2: Object.freeze({ BUTTON_SELECT: 'Digit6', BUTTON_START: 'Digit2' })
});
/** FinalBurn Neo numbers arcade buttons by position: 1 = RetroPad B, 2 = A, 3 = Y, 4 = X, 5 = L, 6 = R. */
const ARCADE_NUMBER: Record<string, string> = { BUTTON_B: '1', BUTTON_A: '2', BUTTON_Y: '3', BUTTON_X: '4', BUTTON_L: '5', BUTTON_R: '6' };

/** Every key that presses a RetroPad button of a player (0 = player 1), in the map's order. */
export function keysFor(input: string, { systemId = 'nes', player = 0 }: { systemId?: string; player?: number } = {}): string[] {
  return Object.entries(keyboardMap(systemId)).filter(([, [p, button]]) => p === player && button === input).map(([code]) => code);
}

export function systemLabel(input: string, arcade: boolean): string {
  if (input === 'BUTTON_SELECT') return arcade ? 'Jeton' : 'Select';
  return arcade ? 'Başla' : 'Start';
}

export function keyHints(spec: PadSpecLike, { arcade = false, systemId = 'nes', player = 0 }: { arcade?: boolean; systemId?: string; player?: number } = {}): KeyHint[] {
  const keys = KEYBOARD_PLAYERS[player] || KEYBOARD_PLAYERS[0];
  const blockOrder = [...keys.bottom, ...keys.top];
  const hints: KeyHint[] = [{ codes: [...keys.move], label: arcade ? 'joystick' : 'yön', kind: 'move' }];
  const buttons = [...spec.face, ...spec.shoulders]
    .map(b => ({ code: keysFor(b.input, { systemId, player })[0], label: b.label || ARCADE_NUMBER[b.input] || '' }))
    .filter(b => b.code)
    // Numbered arcade buttons in number order; letters in the block's order (lower row first).
    .sort((a, b) => (/^\d$/.test(a.label) && /^\d$/.test(b.label) ? Number(a.label) - Number(b.label) : blockOrder.indexOf(a.code) - blockOrder.indexOf(b.code)));
  for (const b of buttons) hints.push({ codes: [b.code], label: b.label, kind: 'button' });
  const primary = player > 0 ? PRIMARY_SYSTEM_KEY.player2 : arcade ? PRIMARY_SYSTEM_KEY.arcade : PRIMARY_SYSTEM_KEY.console;
  for (const s of spec.system) {
    const code = primary[s.input as keyof typeof primary];
    if (code) hints.push({ codes: [code], label: systemLabel(s.input, arcade), kind: 'system' });
  }
  if (player === 0) hints.push({ codes: ['Escape'], label: 'menü', kind: 'menu' });
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

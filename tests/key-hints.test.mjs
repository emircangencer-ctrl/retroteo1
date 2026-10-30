import test from 'node:test';
import assert from 'node:assert/strict';
import { keyHints, keysFor, keyCap, PRIMARY_SYSTEM_KEY } from '../src/lib/key-hints.ts';
import { padSpecFor } from '../src/touch-layout.js';
import { keyboardMap, KEYBOARD_PLAYERS } from '../src/emulatorjs-nes-player.js';

const flat = hints => hints.map(h => `${h.codes.join('+')}=${h.label}`);
const SYSTEM = { NES: 'nes', SNES: 'snes', MD: 'segaMD', ARCADE: 'arcade' };

test('every key the hints name really presses that button for that player', () => {
  for (const [platform, layout, arcade] of [['NES'], ['SNES'], ['MD'], ['ARCADE', 'six'], ['ARCADE', 'neogeo'], ['ARCADE', 'six', { core: 'fbneo', buttons: 2 }]]) {
    const spec = padSpecFor(platform, layout, arcade || null);
    const systemId = SYSTEM[platform];
    const map = keyboardMap(systemId);
    for (const player of [0, 1]) {
      for (const hint of keyHints(spec, { arcade: platform === 'ARCADE', systemId, player }).filter(h => h.kind !== 'menu')) {
        for (const code of hint.codes) {
          assert.equal(map[code]?.[0], player, `${platform}: ${code} is player ${player + 1}'s`);
          if (hint.kind !== 'move') assert.ok([...spec.face, ...spec.shoulders, ...spec.system].some(b => b.input === map[code][1]), `${platform}: ${code} → ${map[code][1]}`);
        }
      }
    }
  }
});

test('one keyboard, two players: player 1 on the right (arrows), player 2 on the left (WASD), no key shared', () => {
  const [one, two] = KEYBOARD_PLAYERS;
  const keys = p => [...p.move, ...p.bottom, ...p.top, ...p.start, ...p.select];
  assert.deepEqual(one.move, ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
  assert.deepEqual(two.move, ['KeyW', 'KeyA', 'KeyS', 'KeyD']);
  assert.equal(keys(one).filter(code => keys(two).includes(code)).length, 0);
  const map = keyboardMap('nes');
  assert.equal(Object.keys(map).length, keys(one).length + keys(two).length, 'every key has one meaning');
  // Physical columns of a QWERTY row: player 2's letters stay left of player 1's.
  const column = code => 'QWERTYUIOP'.indexOf(code.slice(3)) + 1 || 'ASDFGHJKL'.indexOf(code.slice(3)) + 1 || 'ZXCVBNM'.indexOf(code.slice(3)) + 1;
  const letters = p => keys(p).filter(code => /^Key/.test(code));
  assert.ok(Math.max(...letters(two).map(column)) < Math.min(...letters(one).map(column)), 'the halves do not cross');
});

test('arcade: each player has a joystick, six numbered buttons, coin and start (MAME: 5/1 and 6/2)', () => {
  const spec = padSpecFor('ARCADE', 'six');
  assert.deepEqual(flat(keyHints(spec, { arcade: true, systemId: 'arcade' })), [
    'ArrowUp+ArrowLeft+ArrowDown+ArrowRight=joystick',
    'KeyJ=1', 'KeyK=2', 'KeyU=3', 'KeyI=4', 'KeyO=5', 'KeyL=6',
    'Digit5=Jeton', 'Digit1=Başla', 'Escape=menü'
  ]);
  assert.deepEqual(flat(keyHints(spec, { arcade: true, systemId: 'arcade', player: 1 })), [
    'KeyW+KeyA+KeyS+KeyD=joystick',
    'KeyF=1', 'KeyG=2', 'KeyR=3', 'KeyT=4', 'KeyY=5', 'KeyH=6',
    'Digit6=Jeton', 'Digit2=Başla'
  ]);
});

test('a cabinet without buttons (Pac-Man) shows only the joystick, coin and start', () => {
  const spec = padSpecFor('ARCADE', 'six', { core: 'fbneo', buttons: 0, ways: 4 });
  assert.deepEqual(flat(keyHints(spec, { arcade: true, systemId: 'arcade' })), ['ArrowUp+ArrowLeft+ArrowDown+ArrowRight=joystick', 'Digit5=Jeton', 'Digit1=Başla', 'Escape=menü']);
  assert.deepEqual(flat(keyHints(spec, { arcade: true, systemId: 'arcade', player: 1 })), ['KeyW+KeyA+KeyS+KeyD=joystick', 'Digit6=Jeton', 'Digit2=Başla']);
});

test('each console keeps its pad\'s order on the keys: lower row first (NES B A, Mega Drive A B C / X Y Z, Neo Geo A B / C D)', () => {
  assert.deepEqual(flat(keyHints(padSpecFor('NES'), { systemId: 'nes' })), ['ArrowUp+ArrowLeft+ArrowDown+ArrowRight=yön', 'KeyJ=B', 'KeyK=A', 'ShiftRight=Select', 'Enter=Start', 'Escape=menü']);
  assert.deepEqual(flat(keyHints(padSpecFor('NES'), { systemId: 'nes', player: 1 })), ['KeyW+KeyA+KeyS+KeyD=yön', 'KeyF=B', 'KeyG=A', 'Digit6=Select', 'Digit2=Start']);
  assert.deepEqual(flat(keyHints(padSpecFor('SNES'), { systemId: 'snes' })).slice(1, 7), ['KeyJ=B', 'KeyK=A', 'KeyL=R', 'KeyU=Y', 'KeyI=X', 'KeyO=L']);
  const md = flat(keyHints(padSpecFor('MD'), { systemId: 'segaMD' }));
  assert.deepEqual(md.slice(1, 7), ['KeyJ=A', 'KeyK=B', 'KeyL=C', 'KeyU=X', 'KeyI=Y', 'KeyO=Z']);
  assert.deepEqual(flat(keyHints(padSpecFor('MD'), { systemId: 'segaMD', player: 1 })).slice(1, 7), ['KeyF=A', 'KeyG=B', 'KeyH=C', 'KeyR=X', 'KeyT=Y', 'KeyY=Z']);
  assert.ok(!md.some(h => /Select/.test(h)), 'the Mega Drive pad has no Select');
  assert.deepEqual(flat(keyHints(padSpecFor('ARCADE', 'neogeo'), { arcade: true, systemId: 'arcade' })).slice(1, 5), ['KeyJ=A', 'KeyK=B', 'KeyU=C', 'KeyI=D']);
});

test('coin and start: player 1 has keys every keyboard has (Right Ctrl still works); player 2 MAME\'s 6 and 2', () => {
  assert.deepEqual(keysFor('BUTTON_SELECT').sort(), ['ControlRight', 'Digit5', 'ShiftRight']);
  assert.deepEqual(keysFor('BUTTON_START').sort(), ['Digit1', 'Enter', 'NumpadEnter']);
  assert.deepEqual(keysFor('BUTTON_SELECT', { player: 1 }), ['Digit6']);
  assert.deepEqual(keysFor('BUTTON_START', { player: 1 }), ['Digit2']);
  assert.equal(PRIMARY_SYSTEM_KEY.arcade.BUTTON_SELECT, 'Digit5');
  assert.equal(PRIMARY_SYSTEM_KEY.player2.BUTTON_START, 'Digit2');
});

test('key caps follow the keyboard layout when the browser reports it', () => {
  assert.equal(keyCap('KeyJ'), 'J');
  assert.equal(keyCap('Digit5'), '5');
  assert.equal(keyCap('ShiftRight'), 'Sağ Shift');
  // A Turkish F keyboard carries other letters on these positions.
  const f = new Map([['KeyJ', 'k'], ['KeyK', 'm'], ['KeyU', 'r'], ['KeyI', 'n']]);
  assert.deepEqual(['KeyJ', 'KeyK', 'KeyU', 'KeyI'].map(code => keyCap(code, f)), ['K', 'M', 'R', 'N']);
});

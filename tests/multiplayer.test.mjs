import test from 'node:test';
import assert from 'node:assert/strict';
import { PadPlayers, playerCount, padKey, padName, MAX_PLAYERS } from '../src/players.js';
import { GamepadPoller, MENU_COMBO_MS } from '../src/gamepad-input.js';
import { EmulatorJsPlayer, MIN_SYSTEM_PRESS_MS } from '../src/emulatorjs-nes-player.js';

const pad = (index, { pressed = [], id = `Pad ${index}`, axes = [0, 0, 0, 0] } = {}) => ({
  index, id, connected: true, mapping: 'standard', axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 }))
});

// ---- who plays as whom -------------------------------------------------------------------------
test('players per game: two on the consoles, the cabinet count on arcade (up to four, four if unknown)', () => {
  assert.equal(MAX_PLAYERS, 4);
  for (const platform of ['NES', 'SNES', 'MEGADRIVE']) assert.equal(playerCount(platform), 2, platform);
  assert.equal(playerCount('ARCADE', { players: 2 }), 2);
  assert.equal(playerCount('ARCADE', { players: 1 }), 1);
  assert.equal(playerCount('ARCADE', { players: 4 }), 4);
  assert.equal(playerCount('ARCADE', { players: 8 }), 4, 'EmulatorJS passes four players');
  assert.equal(playerCount('ARCADE', { players: 0 }), 4, 'unknown');
  assert.equal(playerCount('ARCADE', null), 4);
});

test('controllers are players in the order they are connected, with no setting; each keeps its player until it leaves', () => {
  const p = new PadPlayers();
  const joined = [];
  p.onJoin = (pad, player) => joined.push(`${pad.id}=${player + 1}`);
  const a = pad(0, { id: 'Xbox' }), b = pad(1, { id: '8BitDo' });
  // Polled in slot order: both are numbered before anyone presses a button.
  assert.equal(p.playerFor(a), 0);
  assert.equal(p.playerFor(b), 1);
  assert.deepEqual(joined, ['Xbox=1', '8BitDo=2']);
  assert.equal(p.playerFor(b, { active: true }), 1, 'pressing changes nothing');
  p.sync([b]);
  assert.equal(p.playerFor(b), 1, 'player 2 stays player 2 when player 1\'s controller leaves');
  const c = pad(0, { id: 'Xbox' });
  assert.equal(p.playerFor(c), 0, 'reconnected: the free player 1 again');
  assert.equal(p.playerFor(pad(2, { id: 'Third' }), { count: 2 }), 0, 'more controllers than the game has players: the extra one plays player 1');
  assert.equal(p.playerFor(b, { count: 1 }), 0, 'a one-player game: every controller plays it');
});

test('a phone sensor listed as a joystick never takes player 1; an unrecognised controller joins when used', () => {
  const p = new PadPlayers();
  const sensor = { ...pad(0, { id: 'uinput-fpc' }), mapping: '' };
  const real = pad(1, { id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)' });
  assert.equal(p.playerFor(sensor), null);
  assert.equal(p.playerFor(sensor, { active: true }), null, 'not even when it reports a press');
  assert.equal(p.playerFor(real), 0, 'the real controller is player 1');
  const generic = { ...pad(2, { id: 'USB Gamepad' }), mapping: '' };
  assert.equal(p.playerFor(generic), null, 'a controller the browser does not map waits for a press');
  assert.equal(p.playerFor(generic, { active: true }), 1);
  assert.deepEqual(p.describe([sensor, real, generic]).map(d => [d.name, d.player]), [['uinput-fpc', null], ['Wireless Controller', 0], ['USB Gamepad', 1]]);
});

test('controller names lose the browser\'s vendor/product suffix', () => {
  assert.equal(padKey(pad(1, { id: 'X' })), '1:X');
  assert.equal(padName({ index: 0, id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)' }), 'Xbox 360 Controller');
  assert.equal(padName({ index: 0, id: '054c-09cc-Wireless Controller' }), 'Wireless Controller');
  assert.equal(padName({ index: 2, id: '' }), 'Kumanda 3');
});

// ---- the poller per player ---------------------------------------------------------------------
function multiPoller(getPads, players, count = 2) {
  let now = 0;
  const changes = [];
  const activity = [];
  let menus = 0;
  const poller = new GamepadPoller({
    getGamepads: getPads,
    playerFor: (p, active) => players.playerFor(p, { active, count }),
    onChange: (pressed, released, player) => changes.push(`P${player + 1} +${pressed.join(',')} -${released.join(',')}`),
    onActivity: player => activity.push(player),
    onMenu: () => menus++,
    requestFrame: () => 1, cancelFrame: () => {}, now: () => now
  });
  return { poller, changes, activity, menus: () => menus, at: t => { now = t; return poller.poll(); } };
}

test('two controllers press the same button for two players; releases go to the player that pressed', () => {
  let pads = [pad(0), pad(1)];
  const p = multiPoller(() => pads, new PadPlayers());
  pads = [pad(0, { pressed: [1] }), pad(1)];
  p.at(0);
  pads = [pad(0, { pressed: [1] }), pad(1, { pressed: [1, 14] })];
  p.at(16);
  assert.deepEqual(p.changes, ['P1 +BUTTON_A -', 'P2 +BUTTON_A,BUTTON_LEFT -']);
  assert.deepEqual([...new Set(p.activity)], [0, 1]);
  pads = [pad(0), pad(1, { pressed: [1, 14] })];
  p.at(32);
  assert.deepEqual(p.changes.at(-1), 'P1 + -BUTTON_A', 'player 2 still holds A');
  p.poller.stop();
  assert.deepEqual(p.changes.at(-1), 'P2 + -BUTTON_A,BUTTON_LEFT', 'stopping releases every player');
});

test('the second controller is player 2 even when it is the first one pressed', () => {
  let pads = [pad(0), pad(1)];
  const p = multiPoller(() => pads, new PadPlayers());
  p.at(0);
  pads = [pad(0), pad(1, { pressed: [0] })];
  p.at(16);
  assert.deepEqual(p.changes, ['P2 +BUTTON_B -']);
});

test('in a one-player game every controller plays player 1, and the same button held on two is one press', () => {
  const pads = [pad(0, { pressed: [0] }), pad(1, { pressed: [0, 15] })];
  const p = multiPoller(() => pads, new PadPlayers(), 1);
  p.at(0);
  assert.deepEqual(p.changes, ['P1 +BUTTON_B,BUTTON_RIGHT -']);
});

test('a controller that moves to another player is let go on the old one before it presses on the new one', () => {
  let pads = [pad(0), pad(1, { pressed: [1] })];
  const players = new PadPlayers();
  const p = multiPoller(() => pads, players);
  p.at(0);
  // If a controller's player changes while a button is held, the core never sees it held by both.
  players.players.set('1:Pad 1', 0);
  p.at(16);
  assert.deepEqual(p.changes, ['P2 +BUTTON_A -', 'P2 + -BUTTON_A', 'P1 +BUTTON_A -']);
});

test('Select + Start on player 2\'s controller opens the menu without reaching the game; player 2\'s Start alone arrives a moment later', () => {
  let pads = [pad(0, { pressed: [0] }), pad(1)];
  const p = multiPoller(() => pads, new PadPlayers());
  p.at(0);
  pads = [pad(0), pad(1, { pressed: [9] })];
  p.at(10);
  p.at(10 + MENU_COMBO_MS / 2);
  assert.deepEqual(p.changes, ['P1 +BUTTON_B -', 'P1 + -BUTTON_B'], 'Start waits for a possible Select');
  p.at(11 + MENU_COMBO_MS);
  assert.equal(p.changes.at(-1), 'P2 +BUTTON_START -', 'player 2 starts (an arcade game\'s 2P start)');
  pads = [pad(0), pad(1)];
  p.at(200);
  pads = [pad(0), pad(1, { pressed: [8, 9] })];
  p.at(300);
  p.at(500);
  assert.equal(p.menus(), 1);
  assert.equal(p.changes.filter(c => c.startsWith('P2 +BUTTON_SELECT')).length, 0, 'the combination never presses Select in the game');
});

// ---- the emulator gets each player's input on its own port -------------------------------------
class FakeFrameWindow extends EventTarget {
  constructor(calls) { super(); this.EJS_emulator = { gameManager: { simulateInput: (...args) => calls.push(args) }, pause: () => {}, play: () => {} }; }
}
function keyEvent(type, code) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, key: { value: code }, location: { value: 0 } });
  return event;
}
function withPlayer(systemId, coreId, run) {
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = new EventTarget();
  globalThis.window = Object.assign(new EventTarget(), { clearTimeout: () => {} });
  const calls = [];
  const player = new EmulatorJsPlayer({ closest: () => ({ classList: { contains: () => false } }), replaceChildren: () => {} }, { systemId, coreId });
  player.frame = Object.assign(new EventTarget(), { contentWindow: new FakeFrameWindow(calls), remove() {} });
  player.started = true;
  player.boundFrameLoad();
  try { run(player, calls); } finally {
    try { player.destroy(); } catch {}
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
  }
}

test('each player\'s buttons reach the core on that player\'s port, held and let go independently', () => {
  withPlayer('nes', 'fceumm', (player, calls) => {
    player.pressButton('BUTTON_A', 'gamepad', 0);
    player.pressButton('BUTTON_A', 'gamepad', 1);
    player.pressButton('BUTTON_RIGHT', 'touch', 1);
    assert.deepEqual(calls, [[0, 8, 1], [1, 8, 1], [1, 7, 1]]);
    calls.length = 0;
    player.releaseButton('BUTTON_A', 'gamepad', 1);
    assert.deepEqual(calls, [[1, 8, 0]], 'player 1 still holds A');
    calls.length = 0;
    player.releaseButton('BUTTON_A', 'gamepad', 7);
    assert.deepEqual(calls, [[0, 8, 0]], 'an unknown player is player 1');
    calls.length = 0;
    player.releaseAllButtons();
    assert.deepEqual(calls, [[1, 7, 0]]);
  });
});

test('a quick Select of player 2 also lasts long enough for an arcade game to see the coin', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withPlayer('mame', 'mame2003_plus', (player, calls) => {
    player.pressButton('BUTTON_SELECT', 'gamepad', 1);
    player.releaseButton('BUTTON_SELECT', 'gamepad', 1);
    assert.deepEqual(calls, [[1, 2, 1]]);
    t.mock.timers.tick(MIN_SYSTEM_PRESS_MS);
    assert.deepEqual(calls, [[1, 2, 1], [1, 2, 0]]);
    calls.length = 0;
    assert.equal(player.tapButton('BUTTON_START', 140, 1), true);
    t.mock.timers.tick(140);
    t.mock.timers.tick(MIN_SYSTEM_PRESS_MS);
    assert.deepEqual(calls, [[1, 3, 1], [1, 3, 0]], 'an on-screen tap for player 2');
  });
});

test('one keyboard, two players from the start: arrows and J K L / U I O for player 1, WASD and F G H / R T Y for player 2', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  withPlayer('mame', 'mame2003_plus', (player, calls) => {
    const win = player.frame.contentWindow;
    const press = code => { calls.length = 0; win.dispatchEvent(keyEvent('keydown', code)); const got = calls.slice(); player.releaseAllButtons(); return got; };
    // [player, RetroPad index]: B 0, Y 1, Select 2, Start 3, Up 4, Down 5, Left 6, Right 7, A 8, X 9, L 10, R 11
    const expected = {
      ArrowUp: [0, 4], ArrowLeft: [0, 6], KeyJ: [0, 0], KeyK: [0, 8], KeyL: [0, 11], KeyU: [0, 1], KeyI: [0, 9], KeyO: [0, 10], Digit5: [0, 2], Digit1: [0, 3], Enter: [0, 3], ShiftRight: [0, 2],
      KeyW: [1, 4], KeyA: [1, 6], KeyS: [1, 5], KeyD: [1, 7], KeyF: [1, 0], KeyG: [1, 8], KeyH: [1, 11], KeyR: [1, 1], KeyT: [1, 9], KeyY: [1, 10], Digit6: [1, 2], Digit2: [1, 3]
    };
    for (const [code, [port, index]] of Object.entries(expected)) assert.deepEqual(press(code), [[port, index, 1]], code);
    for (const code of ['KeyZ', 'KeyX', 'KeyQ', 'KeyV', 'Digit3', 'Digit7']) assert.deepEqual(press(code), [], `${code} plays nothing`);
    // Both players at once: player 2 moves right while player 1 holds A.
    calls.length = 0;
    win.dispatchEvent(keyEvent('keydown', 'KeyK'));
    win.dispatchEvent(keyEvent('keydown', 'KeyD'));
    win.dispatchEvent(keyEvent('keyup', 'KeyK'));
    win.dispatchEvent(keyEvent('keyup', 'KeyD'));
    assert.deepEqual(calls, [[0, 8, 1], [1, 7, 1], [0, 8, 0], [1, 7, 0]]);
  });
  withPlayer('segaMD', 'segaMD', (player, calls) => {
    const win = player.frame.contentWindow;
    for (const code of ['KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'KeyO']) win.dispatchEvent(keyEvent('keydown', code));
    assert.deepEqual(calls.map(([, index]) => index), [1, 0, 8, 10, 9, 11], 'Mega Drive: A B C below, X Y Z above (Genesis Plus GX: Y B A / L X R)');
  });
});

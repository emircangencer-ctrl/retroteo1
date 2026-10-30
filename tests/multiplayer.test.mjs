import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerAssignment, playerCount, padKey, padName, MAX_PLAYERS } from '../src/players.js';
import { GamepadPoller, MENU_COMBO_MS } from '../src/gamepad-input.js';
import { EmulatorJsPlayer, ARCADE_PLAYER_KEYS, MIN_SYSTEM_PRESS_MS } from '../src/emulatorjs-nes-player.js';

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

test('controllers get players in the order they are first used and keep them until they leave', () => {
  const a = new PlayerAssignment({ count: 2 });
  const p0 = pad(0, { id: 'Phone sensor' }), p1 = pad(1, { id: 'Xbox' }), p2 = pad(2, { id: '8BitDo' });
  assert.equal(a.playerOf(p0), null, 'a controller nobody used has no player (Android lists sensors as controllers)');
  assert.deepEqual(a.use(p1), { player: 0, joined: true }, 'the first controller used is player 1, whatever its slot');
  assert.deepEqual(a.use(p1), { player: 0, joined: false });
  assert.deepEqual(a.use(p2), { player: 1, joined: true }, 'the next one is player 2');
  assert.equal(a.touch, 0, 'touch and keyboard stay player 1');
  assert.equal(a.keyboard, 0);
  assert.equal(a.sync([p0, p2]), true, 'player 1 disconnected');
  assert.equal(a.playerOf(p1), null);
  assert.equal(a.playerOf(p2), 1, 'player 2 stays player 2');
  assert.deepEqual(a.use(p1), { player: 0, joined: true }, 'back: the free player 1');
  assert.equal(a.sync([p0, p1, p2]), false);
});

test('a single controller is player 1 alongside touch and keyboard; extra controllers beyond the game share player 1', () => {
  const a = new PlayerAssignment({ count: 1 });
  assert.equal(a.use(pad(0)).player, 0);
  assert.equal(a.use(pad(1)).player, 0, 'a one-player game: every controller plays it');
  a.setCount(2);
  assert.equal(a.playerOf(pad(1)), 0, 'a player number, once given, is not taken away by a bigger game');
});

test('choices from the menu: any controller, the touch pad or the keyboard can be any player of the game', () => {
  const a = new PlayerAssignment({ count: 4 });
  a.use(pad(0));
  a.setPad(pad(0), 2);
  assert.equal(a.playerOf(pad(0)), 2);
  assert.equal(a.use(pad(1)).player, 0, 'the next controller takes the lowest free player');
  a.setPad(pad(3), 1);
  assert.equal(a.playerOf(pad(3)), 1, 'a controller can be given a player before it is used');
  a.setTouch(1);
  a.setKeyboard(3);
  assert.deepEqual([a.touch, a.keyboard], [1, 3]);
  a.setTouch(9);
  assert.equal(a.touch, 0, 'out of range: player 1');
  // A two-player game next: players it does not have move to free ones (or player 1).
  a.setTouch(1);
  a.setCount(2);
  assert.equal(a.keyboard, 0);
  assert.equal(a.touch, 1);
  assert.deepEqual([a.playerOf(pad(1)), a.playerOf(pad(3))], [0, 1]);
  assert.equal(a.playerOf(pad(0)), 0, 'player 3 had no place in a two-player game: player 1');
  assert.deepEqual(a.describe([pad(3), null, pad(1, { id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)' })]).map(p => [p.index, p.name, p.player]), [[1, 'Wireless Controller', null], [3, 'Pad 3', 1]]);
});

test('controller identity is its slot and name; names lose the browser\'s vendor/product suffix', () => {
  assert.equal(padKey(pad(1, { id: 'X' })), '1:X');
  assert.notEqual(padKey(pad(1, { id: 'X' })), padKey(pad(1, { id: 'Y' })));
  assert.equal(padName({ index: 0, id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)' }), 'Xbox 360 Controller');
  assert.equal(padName({ index: 0, id: '054c-09cc-Wireless Controller' }), 'Wireless Controller');
  assert.equal(padName({ index: 2, id: '' }), 'Kumanda 3');
});

// ---- the poller per player ---------------------------------------------------------------------
function multiPoller(getPads, assignment) {
  let now = 0;
  const changes = [];
  const activity = [];
  let menus = 0;
  const poller = new GamepadPoller({
    getGamepads: getPads,
    playerFor: (p, active) => (active ? assignment.use(p).player : assignment.playerOf(p)),
    onChange: (pressed, released, player) => changes.push(`P${player + 1} +${pressed.join(',')} -${released.join(',')}`),
    onActivity: player => activity.push(player),
    onMenu: () => menus++,
    requestFrame: () => 1, cancelFrame: () => {}, now: () => now
  });
  return { poller, changes, activity, menus: () => menus, at: t => { now = t; return poller.poll(); } };
}

test('two controllers press the same button for two players; releases go to the player that pressed', () => {
  const a = new PlayerAssignment({ count: 2 });
  let pads = [pad(0), pad(1)];
  const p = multiPoller(() => pads, a);
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

test('a controller nobody used yet sends nothing; controllers of the same player are combined', () => {
  const a = new PlayerAssignment({ count: 2 });
  let pads = [pad(0), pad(1)];
  const p = multiPoller(() => pads, a);
  p.at(0);
  assert.deepEqual(p.changes, []);
  assert.equal(a.playerOf(pad(0)), null);
  pads = [pad(0, { pressed: [0] }), pad(1)];
  p.at(16);
  a.setPad(pad(1), 0);
  pads = [pad(0, { pressed: [0] }), pad(1, { pressed: [0, 15] })];
  p.at(32);
  assert.deepEqual(p.changes, ['P1 +BUTTON_B -', 'P1 +BUTTON_RIGHT -'], 'B held on both is one press');
});

test('moving a controller to another player lets go on the old player and presses on the new one', () => {
  const a = new PlayerAssignment({ count: 2 });
  const pads = [pad(0, { pressed: [1] })];
  const p = multiPoller(() => pads, a);
  p.at(0);
  a.setPad(pad(0), 1);
  p.at(16);
  assert.deepEqual(p.changes, ['P1 +BUTTON_A -', 'P1 + -BUTTON_A', 'P2 +BUTTON_A -']);
});

test('Select + Start on player 2\'s controller opens the menu without reaching the game; player 2\'s Start alone arrives a moment later', () => {
  const a = new PlayerAssignment({ count: 2 });
  let pads = [pad(0, { pressed: [0] }), pad(1)];
  const p = multiPoller(() => pads, a);
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

test('the keyboard plays as its chosen player; on arcade boards 2/6, 3/7, 4/8 are the other players\' start and coin', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(ARCADE_PLAYER_KEYS.Digit2, [1, 'BUTTON_START']);
  assert.deepEqual(ARCADE_PLAYER_KEYS.Digit6, [1, 'BUTTON_SELECT']);
  withPlayer('mame', 'mame2003_plus', (player, calls) => {
    const win = player.frame.contentWindow;
    for (const [code, expected] of [['Digit2', [1, 3]], ['Digit6', [1, 2]], ['Digit3', [2, 3]], ['Digit7', [2, 2]], ['Digit4', [3, 3]], ['Digit8', [3, 2]], ['Digit1', [0, 3]], ['Digit5', [0, 2]]]) {
      calls.length = 0;
      win.dispatchEvent(keyEvent('keydown', code));
      assert.deepEqual(calls, [[...expected, 1]], code);
      player.releaseAllButtons();
    }
    calls.length = 0;
    player.setKeyboardPlayer(1);
    win.dispatchEvent(keyEvent('keydown', 'KeyX'));
    win.dispatchEvent(keyEvent('keydown', 'Digit1'));
    assert.deepEqual(calls, [[1, 8, 1], [1, 3, 1]], 'X and 1 for player 2');
    calls.length = 0;
    player.setKeyboardPlayer(0);
    t.mock.timers.tick(MIN_SYSTEM_PRESS_MS);
    assert.deepEqual(calls.map(c => c.join()).sort(), ['1,3,0', '1,8,0'], 'changing the keyboard\'s player lets go of its keys');
    calls.length = 0;
    win.dispatchEvent(keyEvent('keyup', 'KeyX'));
    assert.deepEqual(calls, [], 'already let go');
    win.dispatchEvent(keyEvent('keydown', 'KeyX'));
    win.dispatchEvent(keyEvent('keyup', 'KeyX'));
    assert.deepEqual(calls, [[0, 8, 1], [0, 8, 0]]);
  });
  withPlayer('nes', 'fceumm', (player, calls) => {
    player.frame.contentWindow.dispatchEvent(keyEvent('keydown', 'Digit2'));
    assert.deepEqual(calls, [], 'consoles: 2 is not a game key');
  });
});
